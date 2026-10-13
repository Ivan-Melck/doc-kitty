# Bulk import of consignees

*1 scenario*

## Scenario: Import consignees with awkward values

- **Given** the following consignees:

  | name | address | note |
  | --- | --- | --- |
  | A \| B Trading | 1 Pipe St | |
  | \*Star\* Ltd | &lt;b&gt;bold&lt;/b&gt; &amp; co | \[link\](x) |
  | | \`code\` \_under\_ \{x\} | back\\slash |

- **And** a single-row table:

  | only | header |
  | --- | --- |

- **When** the import runs
- **Then** 3 consignees exist
