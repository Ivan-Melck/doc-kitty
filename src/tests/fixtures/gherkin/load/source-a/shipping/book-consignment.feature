@dk:context=shipping
Feature: Book consignment
  As a shipper
  I want to book a consignment
  So that my goods are moved

  Background:
    Given a registered shipper

  Scenario: Book a single consignment
    Given an empty booking
    When the shipper books 1 pallet
    Then the booking contains 1 pallet

  Scenario Outline: Book several pallets
    When the shipper books <count> pallets
    Then the booking contains <count> pallets

    Examples:
      | count |
      | 2     |
      | 5     |
