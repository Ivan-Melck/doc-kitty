Feature: Invoice payment terms
  Invoices are due according to the customer's payment terms.

  Rule: Standard customers pay within 30 days
    Standard terms apply to every customer without a contract.

    Background:
      Given a standard customer

    @billing
    Scenario: Invoice is due after 30 days
      When an invoice is issued on 2026-01-01
      Then the invoice is due on 2026-01-31

  @contract
  Rule: Contract customers pay within the contract term

    Background:
      Given a customer with a 60-day contract

    Scenario: Invoice is due after the contract term
      When an invoice is issued on 2026-01-01
      Then the invoice is due on 2026-03-02
