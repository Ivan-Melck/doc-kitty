Feature: Billing
  Scenario: Raise an invoice
    Given a delivered consignment
    When billing runs
    Then an invoice is raised
