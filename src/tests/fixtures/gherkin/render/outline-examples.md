# Price a shipment

*1 scenario · 5 example rows*

## Scenario Outline: Price by weight band

Prices are looked up per weight band.

`@FR-007` `@pricing`

- **Given** a parcel weighing `<weight>` kg
- **When** the parcel is priced for `<zone>`
- **Then** the price is `<price>` EUR

**Examples: Domestic** `@domestic`

| weight | zone | price |
| --- | --- | --- |
| 1 | domestic | 4.50 |
| 10 | domestic | 9.00 |

**Examples: International** `@international` `@slow`

Surcharges apply outside the EU.

| weight | zone | price |
| --- | --- | --- |
| 1 | international | 12.00 |
| &lt;none&gt; | international | n/a |
| 30 | international | 60.00 |
