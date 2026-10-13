Feature: Render shipping labels

  Scenario: Label template contains a code fence
    Given the label template:
      """markdown
      # Label

      ```
      CONSIGNEE: ACME
      ```

      Ship ````soon````.
      """
    When the label is rendered
    Then the output is plain text:
      """
      CONSIGNEE: ACME
      """
    And the request body is:
      """application/vnd.api+json; charset=utf-8
      {"data": []}
      """
