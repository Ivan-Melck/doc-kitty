# Render shipping labels

*1 scenario*

## Scenario: Label template contains a code fence

- **Given** the label template:

  `````markdown
  # Label

  ```
  CONSIGNEE: ACME
  ```

  Ship ````soon````.
  `````

- **When** the label is rendered
- **Then** the output is plain text:

  ```text
  CONSIGNEE: ACME
  ```

- **And** the request body is:

  ```applicationvnd.api+jsoncharsetutf-8
  {"data": []}
  ```
