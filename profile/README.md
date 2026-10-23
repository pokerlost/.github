<img src="https://raw.githubusercontent.com/pokerlost/.github/main/profile/assets/logo.svg" alt="Pokerlost" width="56" height="56" />

# Pokerlost

Poker libraries, service foundations and web clients, built around an authoritative
C++ engine with a Python API.

[Public repositories](https://github.com/orgs/pokerlost/repositories?type=public)

## ♠️ Try PokerDemo

A WebSocket server and two interactive terminal tables: cards, shared board,
legal-action buttons and a bet picker. PokerEngine validates actions and settles
the hand.

![PokerDemo: own cards, a shared board and a bet picker](https://raw.githubusercontent.com/pokerlost/pokerDemo/main/docs/assets/demo.gif)

[Recording provenance](https://github.com/pokerlost/pokerDemo/blob/main/docs/assets/demo.json).

[Source and quick start](https://github.com/pokerlost/pokerDemo#quick-start) ·
[Play and record a game](https://github.com/pokerlost/pokerDemo/blob/main/docs/demo.md)

```bash
make demo              # play with two terminal clients
make demo-record-open  # record a hand and open the GIF
```

Run these from the prepared PokerDemo checkout; follow the quick start to install
its dependencies first.

The demo uses synthetic players and chips on loopback. It needs the separately
supplied CPython 3.14 Linux wheel and has no production authentication, TLS or
persistence. Product services and production deployment are still in development.

Original profile documentation and owned assets use [MIT](../LICENSE); preserve
the [third-party notices](../THIRD_PARTY_NOTICES.md).
