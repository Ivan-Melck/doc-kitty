Feature: Price a shipment

  @pricing @FR-007
  Scenario Outline: Price by weight band
    Prices are looked up per weight band.

    Given a parcel weighing <weight> kg
    When the parcel is priced for <zone>
    Then the price is <price> EUR

    @domestic
    Examples: Domestic
      | weight | zone     | price |
      | 1      | domestic | 4.50  |
      | 10     | domestic | 9.00  |

    @international @slow
    Examples: International
      Surcharges apply outside the EU.

      | weight | zone          | price |
      | 1      | international | 12.00 |
      | <none> | international | n/a   |
      | 30     | international | 60.00 |
