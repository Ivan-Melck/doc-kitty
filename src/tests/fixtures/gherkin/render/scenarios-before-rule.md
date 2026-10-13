# Customs declarations

*2 rules · 3 scenarios*

## Background

- **Given** a consignment bound for the UK

## Scenario: Declaration is required

- **Then** a customs declaration is required

## Rule: Low-value consignments are simplified

### Scenario: Simplified declaration below the threshold

- **Given** the consignment is valued at 100 GBP
- **Then** a simplified declaration is accepted

## Rule: High-value consignments need a full declaration

### Scenario: Full declaration above the threshold

- **Given** the consignment is valued at 5000 GBP
- **Then** a full declaration is required
