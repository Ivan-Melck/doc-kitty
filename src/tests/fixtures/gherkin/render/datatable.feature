Feature: Bulk import of consignees

  Scenario: Import consignees with awkward values
    Given the following consignees:
      | name          | address              | note        |
      | A \| B Trading | 1 Pipe St            |             |
      | *Star* Ltd    | <b>bold</b> & co     | [link](x)   |
      |               | `code` _under_ {x}   | back\\slash |
    And a single-row table:
      | only | header |
    When the import runs
    Then 3 consignees exist
