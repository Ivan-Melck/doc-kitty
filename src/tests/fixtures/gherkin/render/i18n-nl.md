# Zending boeken

Als verlader wil ik lading boeken.

*2 scenarios · 1 example row*

## Achtergrond

- **Gegeven** een afvaart met 40 TEU beschikbaar

## Scenario: Lading die past

- **Gegeven** een zending van 12 TEU
- **Als** de verlader de zending boekt
- **Dan** is de boeking bevestigd
- **En** heeft de afvaart 28 TEU over

## Abstract Scenario: Lading die niet past

- **Gegeven** een zending van `<grootte>` TEU
- **Als** de verlader de zending boekt
- **Dan** wordt de boeking geweigerd

**Voorbeelden**

| grootte |
| --- |
| 41 |
