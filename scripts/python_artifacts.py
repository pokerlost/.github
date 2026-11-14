"""Inspect Python distributions and transport ZIPs without executing package code."""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import re
import stat
import sys
import tarfile
import tomllib
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
from typing import Any

from packaging.specifiers import SpecifierSet
from packaging.tags import parse_tag
from packaging.utils import (
    canonicalize_name,
    parse_sdist_filename,
    parse_wheel_filename,
)
from packaging.version import Version

MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_ENTRIES = 20000
MAX_CONTROL = 4 * 1024 * 1024
CONTROL_FILE = "python-build-receipt.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(name: str) -> PurePosixPath:
    require(isinstance(name, str) and bool(name), "Empty archive path")
    require(
        not any(char in name for char in ("\\", ":", "\x00")), "Unsafe archive path"
    )
    path = PurePosixPath(name)
    require(
        not path.is_absolute()
        and all(part not in {"", ".", ".."} for part in name.rstrip("/").split("/")),
        "Unsafe archive path",
    )
    return path


def zip_members(archive: zipfile.ZipFile, flat: bool = False) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    require(0 < len(members) <= MAX_ENTRIES, "ZIP entry count outside limits")
    seen: set[str] = set()
    total = 0
    for item in members:
        path = safe_path(item.filename)
        require(item.filename not in seen, "Duplicate ZIP entry")
        seen.add(item.filename)
        kind = stat.S_IFMT(item.external_attr >> 16)
        require(
            kind in {0, stat.S_IFREG, stat.S_IFDIR},
            "ZIP links or special files are forbidden",
        )
        require(not item.flag_bits & 1, "Encrypted ZIP entries are forbidden")
        require(0 <= item.file_size <= MAX_FILE, "ZIP member exceeds size limit")
        total += item.file_size
        require(total <= MAX_TOTAL, "ZIP exceeds expanded size limit")
        require(
            item.file_size <= max(item.compress_size, 1) * 1000,
            "ZIP expansion ratio exceeds limit",
        )
        if flat:
            require(
                len(path.parts) == 1 and not item.is_dir(),
                "Artifact ZIP must contain flat regular files",
            )
            require(allowed_asset(item.filename), "Unexpected artifact ZIP member")
        require(
            kind == 0
            or (item.is_dir() and kind == stat.S_IFDIR)
            or (not item.is_dir() and kind == stat.S_IFREG),
            "Contradictory ZIP directory mode",
        )
    return members


def allowed_asset(name: str) -> bool:
    return (
        bool(re.fullmatch(r"[A-Za-z0-9_.+-]+\.(?:whl|tar\.gz)", name))
        or name == CONTROL_FILE
    )


def metadata(raw: bytes, allocation: dict[str, Any]) -> dict[str, str]:
    require(len(raw) <= MAX_CONTROL, "Metadata exceeds size limit")
    parsed = BytesParser().parsebytes(raw)
    require(not parsed.defects, "Malformed package metadata")
    result: dict[str, str] = {}
    for key in ("Name", "Version", "Metadata-Version"):
        values = parsed.get_all(key, [])
        require(
            len(values) == 1 and bool(values[0]), f"Missing or duplicate metadata {key}"
        )
        result[key] = str(values[0])
    require(
        canonicalize_name(result["Name"], validate=True) == allocation["bundleName"],
        "Package name mismatch",
    )
    require(
        result["Version"] == allocation["pythonVersion"],
        "Embedded package version mismatch",
    )
    require(
        str(Version(result["Version"])) == result["Version"],
        "Package version is not canonical PEP 440",
    )
    spec = parsed.get_all("Requires-Python", [])
    require(len(spec) <= 1, "Duplicate Requires-Python")
    if spec:
        require(bool(str(spec[0]).strip()), "Empty Requires-Python")
        result["requiresPython"] = str(SpecifierSet(str(spec[0])))
    return result


def load_allocation(path: Path) -> dict[str, Any]:
    require(
        path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_CONTROL,
        "Invalid allocation file",
    )
    value = json.loads(path.read_text())
    require(
        isinstance(value, dict)
        and value.get("schemaVersion") == 2
        and value.get("adapter") == "python",
        "Unsupported Python allocation schema",
    )
    name, version, tags = (
        value.get("bundleName"),
        value.get("pythonVersion"),
        value.get("wheelTags"),
    )
    require(
        isinstance(name, str) and canonicalize_name(name, validate=True) == name,
        "Expected canonical package name",
    )
    require(
        isinstance(version, str) and str(Version(version)) == version,
        "Expected canonical Python version",
    )
    require(
        bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:\.dev[0-9]+)?", version)),
        "Unsupported allocated Python version",
    )
    require(
        isinstance(tags, list)
        and 0 < len(tags) <= 100
        and all(isinstance(tag, str) for tag in tags),
        "Expected wheelTags array",
    )
    require(len(set(tags)) == len(tags), "Duplicate expected wheel tag")
    for tag in tags:
        parsed = parse_tag(tag)
        require(
            len(parsed) == 1 and str(next(iter(parsed))) == tag,
            "Expected single canonical wheel tag",
        )
    return value


def project_contract(
    data: dict[str, Any], package_name: str, version_target: str
) -> dict[str, str]:
    require(
        canonicalize_name(package_name, validate=True) == package_name,
        "Expected canonical source package name",
    )
    require(
        str(Version(version_target)) == version_target
        and bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version_target)),
        "Expected stable canonical version target",
    )
    require(isinstance(data, dict), "Invalid source pyproject")
    build = data.get("build-system")
    native = data.get("project")
    require(
        isinstance(build, dict) and isinstance(native, dict),
        "Missing source build-system or project",
    )
    backend = build.get("build-backend")
    require(
        isinstance(backend, str)
        and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?::[A-Za-z_]\w*)?", backend)
        ),
        "Missing declared Python build backend",
    )
    name = native.get("name")
    require(
        isinstance(name, str)
        and canonicalize_name(name, validate=True) == package_name,
        "Source pyproject name mismatch",
    )
    dynamic = native.get("dynamic", [])
    require(
        isinstance(dynamic, list)
        and all(isinstance(field, str) for field in dynamic)
        and len(set(dynamic)) == len(dynamic),
        "Invalid source dynamic metadata declaration",
    )
    if "version" in native:
        version = native["version"]
        require(
            isinstance(version, str)
            and str(Version(version)) == version
            and bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:\.dev[0-9]+)?", version))
            and "version" not in dynamic,
            "Invalid source static version",
        )
        require(
            Version(version).base_version == version_target,
            "Source version target mismatch",
        )
        mode = "static"
    else:
        require("version" in dynamic, "Missing source static or dynamic version")
        mode = "dynamic"
    result = {"backend": backend, "versionMode": mode}
    if "requires-python" in native:
        spec = native["requires-python"]
        require(
            isinstance(spec, str) and bool(spec.strip()),
            "Invalid source Requires-Python",
        )
        result["requiresPython"] = str(SpecifierSet(spec))
    return result


def source_contract(
    path: Path, package_name: str, version_target: str
) -> dict[str, str]:
    require(
        path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_CONTROL,
        "Invalid source pyproject file",
    )
    return project_contract(
        tomllib.loads(path.read_text()), package_name, version_target
    )


def wheel_metadata(
    path: Path, allocation: dict[str, Any], raw: bytes
) -> dict[str, Any]:
    name, version, build, tags = parse_wheel_filename(path.name)
    require(
        name == allocation["bundleName"]
        and str(version) == allocation["pythonVersion"]
        and not build,
        "Wheel filename identity mismatch",
    )
    require(len(tags) == 1, "Compressed wheel tags are unsupported in schema 2")
    tag = str(next(iter(tags)))
    require(tag in allocation["wheelTags"], "Unexpected Python/ABI/platform tag")
    expected_name = allocation["bundleName"].replace("-", "_")
    require(
        path.name == f"{expected_name}-{allocation['pythonVersion']}-{tag}.whl",
        "Wheel filename is not canonical",
    )
    prefix = f"{expected_name}-{allocation['pythonVersion']}.dist-info/"
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = zip_members(archive)
        files = {item.filename: item for item in members if not item.is_dir()}
        require(
            all(not name.endswith(("/RECORD.jws", "/RECORD.p7s")) for name in files),
            "Wheel signatures are unsupported",
        )
        require(
            [name for name in files if name.endswith(".dist-info/METADATA")]
            == [prefix + "METADATA"],
            "Wheel metadata inventory mismatch",
        )
        for suffix in ("WHEEL", "RECORD"):
            require(prefix + suffix in files, f"Missing wheel {suffix}")
        result = metadata(archive.read(prefix + "METADATA"), allocation)
        wheel = BytesParser().parsebytes(archive.read(prefix + "WHEEL"))
        versions = wheel.get_all("Wheel-Version", [])
        require(
            len(versions) == 1 and bool(re.fullmatch(r"1\.[0-9]+", str(versions[0]))),
            "Unsupported Wheel-Version",
        )
        require(wheel.get_all("Tag", []) == [tag], "WHEEL tags differ from filename")
        pure = wheel.get_all("Root-Is-Purelib", [])
        require(
            len(pure) == 1 and pure[0] in {"true", "false"}, "Invalid Root-Is-Purelib"
        )
        require(
            pure[0] != "true" or tag.endswith("-none-any"),
            "Pure wheel has platform ABI tag",
        )
        record_raw = archive.read(prefix + "RECORD")
        require(len(record_raw) <= MAX_CONTROL, "RECORD exceeds size limit")
        rows = list(csv.reader(io.StringIO(record_raw.decode("utf-8"))))
        records: dict[str, tuple[str, str]] = {}
        for row in rows:
            require(len(row) == 3, "Malformed wheel RECORD")
            filename, checksum, size = row
            safe_path(filename)
            require(filename not in records, "Duplicate wheel RECORD row")
            records[filename] = (checksum, size)
        require(set(records) == set(files), "Wheel RECORD inventory mismatch")
        for filename, (checksum, size) in records.items():
            if filename == prefix + "RECORD":
                require(checksum == size == "", "RECORD self entry must be empty")
                continue
            content = archive.read(filename)
            expected = (
                base64.urlsafe_b64encode(hashlib.sha256(content).digest())
                .rstrip(b"=")
                .decode("ascii")
            )
            require(
                checksum == "sha256=" + expected and size == str(len(content)),
                "Wheel RECORD checksum or size mismatch",
            )
    return {
        "name": path.name,
        "sha256": digest(raw),
        "packageName": allocation["bundleName"],
        "version": allocation["pythonVersion"],
        "tags": [tag],
        **(
            {"requiresPython": result["requiresPython"]}
            if "requiresPython" in result
            else {}
        ),
    }


class BoundedGzipReader:
    """Bound every decompressed byte, including hidden tar/PAX headers and padding."""

    def __init__(self, raw: bytes) -> None:
        self.source = gzip.GzipFile(fileobj=io.BytesIO(raw))
        self.remaining = min(MAX_TOTAL, max(len(raw), 1) * 1000)

    def read(self, size: int = -1) -> bytes:
        require(0 <= size <= MAX_FILE, "Sdist read exceeds size limit")
        data = self.source.read(min(size, self.remaining + 1))
        self.remaining -= len(data)
        require(self.remaining >= 0, "Sdist exceeds expanded size limit")
        return data


def sdist_metadata(
    path: Path,
    allocation: dict[str, Any],
    raw: bytes,
    original: dict[str, str] | None = None,
) -> dict[str, Any]:
    name, version = parse_sdist_filename(path.name)
    require(
        name == allocation["bundleName"]
        and str(version) == allocation["pythonVersion"],
        "Sdist filename identity mismatch",
    )
    root = f"{allocation['bundleName'].replace('-', '_')}-{allocation['pythonVersion']}"
    require(path.name == root + ".tar.gz", "Sdist filename is not canonical")
    contents: dict[str, bytes] = {}
    seen: set[str] = set()
    total = 0
    reader = BoundedGzipReader(raw)
    with tarfile.open(fileobj=reader, mode="r|") as archive:
        for item in archive:
            require(len(seen) < MAX_ENTRIES, "Sdist entry count outside limits")
            member = safe_path(item.name)
            require(item.name not in seen, "Duplicate sdist member")
            seen.add(item.name)
            require(member.parts[0] == root, "Sdist has unexpected root")
            require(
                item.isfile() or item.isdir(),
                "Sdist links or special files are forbidden",
            )
            require(0 <= item.size <= MAX_FILE, "Sdist member exceeds size limit")
            total += item.size
            require(
                total <= MAX_TOTAL and total <= max(len(raw), 1) * 1000,
                "Sdist exceeds expanded size limit",
            )
            if item.isfile():
                source = archive.extractfile(item)
                require(source is not None, "Unreadable sdist member")
                content = source.read(MAX_FILE + 1)
                require(len(content) == item.size, "Sdist member size mismatch")
                if item.name in {root + "/PKG-INFO", root + "/pyproject.toml"}:
                    require(
                        len(content) <= MAX_CONTROL, "Sdist metadata exceeds size limit"
                    )
                    contents[item.name] = content
    while reader.read(65536):
        pass
    reader.source.close()
    require(
        set(contents) == {root + "/PKG-INFO", root + "/pyproject.toml"},
        "Missing sdist PKG-INFO or pyproject.toml",
    )
    result = metadata(contents[root + "/PKG-INFO"], allocation)
    metadata_version = result["Metadata-Version"]
    require(
        bool(re.fullmatch(r"2\.[0-9]+", metadata_version))
        and int(metadata_version.split(".")[1]) >= 2,
        "Sdist requires Metadata-Version >= 2.2 (PEP 625)",
    )
    project = tomllib.loads(contents[root + "/pyproject.toml"].decode("utf-8"))
    backend = project.get("build-system", {}).get("build-backend")
    require(
        isinstance(backend, str)
        and bool(
            re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?::[A-Za-z_]\w*)?", backend)
        ),
        "Missing declared Python build backend",
    )
    native = project.get("project", {})
    require(
        canonicalize_name(native.get("name", ""), validate=True)
        == allocation["bundleName"],
        "Sdist pyproject name mismatch",
    )
    if "version" in native:
        require(
            native["version"] == allocation["pythonVersion"]
            and "version" not in native.get("dynamic", []),
            "Sdist pyproject version mismatch",
        )
    else:
        require(
            "version" in native.get("dynamic", []),
            "Sdist has no static or dynamic version declaration",
        )
    expected_spec = (
        str(SpecifierSet(native["requires-python"]))
        if "requires-python" in native
        else None
    )
    require(
        result.get("requiresPython") == expected_spec,
        "Sdist Requires-Python differs from pyproject",
    )
    if original is not None:
        require(backend == original["backend"], "Source build backend mismatch")
        require(
            expected_spec == original.get("requiresPython"),
            "Source Requires-Python mismatch",
        )
        mode = "static" if "version" in native else "dynamic"
        require(
            mode == original["versionMode"], "Source version injection mode mismatch"
        )
    return {
        "name": path.name,
        "sha256": digest(raw),
        "packageName": allocation["bundleName"],
        "version": allocation["pythonVersion"],
        "buildBackend": backend,
        **(
            {"requiresPython": result["requiresPython"]}
            if "requiresPython" in result
            else {}
        ),
    }


def verify(
    allocation: dict[str, Any], directory: Path, original: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    require(
        directory.is_dir() and not directory.is_symlink(), "Invalid artifact directory"
    )
    entries = sorted(directory.iterdir())
    require(0 < len(entries) <= 102, "Artifact file count outside limits")
    results: list[dict[str, Any]] = []
    total = 0
    for path in entries:
        require(
            path.is_file() and not path.is_symlink() and allowed_asset(path.name),
            "Unexpected artifact file or symlink",
        )
        require(
            path.stat().st_size
            <= (MAX_CONTROL if path.name == CONTROL_FILE else MAX_FILE),
            "Artifact exceeds size limit",
        )
        if path.name == CONTROL_FILE:
            continue
        raw = path.read_bytes()
        total += len(raw)
        require(total <= MAX_TOTAL, "Artifacts exceed size limit")
        if path.suffix == ".whl":
            results.append(wheel_metadata(path, allocation, raw))
        else:
            results.append(sdist_metadata(path, allocation, raw, original))
    wheels = [item for item in results if "tags" in item]
    require(
        len(wheels) == len(allocation["wheelTags"])
        and {item["tags"][0] for item in wheels} == set(allocation["wheelTags"]),
        "Missing or duplicate configured wheel variant",
    )
    require(len(results) == len(wheels) + 1, "Expected exactly one sdist")
    require(
        len({item.get("requiresPython") for item in results}) == 1,
        "Wheel/sdist Requires-Python mismatch",
    )
    return results


def extract(archive_path: Path, directory: Path) -> None:
    require(
        archive_path.is_file()
        and not archive_path.is_symlink()
        and archive_path.stat().st_size <= MAX_TOTAL,
        "Invalid transport archive",
    )
    require(
        not directory.exists() and not directory.is_symlink(),
        "Extraction destination must not exist",
    )
    with zipfile.ZipFile(archive_path) as archive:
        members = zip_members(archive, flat=True)
        # Read and CRC-check every member before creating output files.
        contents = [(item.filename, archive.read(item)) for item in members]
    directory.mkdir(parents=True)
    for filename, content in contents:
        with (directory / filename).open("xb") as target:
            target.write(content)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("verify")
    check.add_argument("--allocation", required=True, type=Path)
    check.add_argument("--directory", required=True, type=Path)
    check.add_argument("--source-pyproject", type=Path)
    check.add_argument("--version-target")
    source = commands.add_parser("source")
    source.add_argument("--pyproject", required=True, type=Path)
    source.add_argument("--package-name", required=True)
    source.add_argument("--version-target", required=True)
    unpack = commands.add_parser("extract")
    unpack.add_argument("--archive", required=True, type=Path)
    unpack.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "verify":
            allocation = load_allocation(args.allocation)
            require(
                bool(args.source_pyproject) == bool(args.version_target),
                "Source pyproject and version target must be provided together",
            )
            original = (
                source_contract(
                    args.source_pyproject, allocation["bundleName"], args.version_target
                )
                if args.source_pyproject
                else None
            )
            print(
                json.dumps(
                    verify(allocation, args.directory, original),
                    sort_keys=True,
                    separators=(",", ":"),
                )
            )
        elif args.command == "source":
            print(
                json.dumps(
                    source_contract(
                        args.pyproject, args.package_name, args.version_target
                    ),
                    sort_keys=True,
                    separators=(",", ":"),
                )
            )
        else:
            extract(args.archive, args.directory)
    except (
        ValueError,
        OSError,
        KeyError,
        TypeError,
        zipfile.BadZipFile,
        tarfile.TarError,
        UnicodeError,
    ) as error:
        print(f"Python artifact verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
