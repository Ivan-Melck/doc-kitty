# language: en
@FR-012
Feature: Request annual leave
  As an employee
  I want to request annual leave from the people team
  So that my time off is agreed before I plan around it

  Leave requests are checked against the employee's remaining allowance. A
  request that overlaps a team blackout period needs the manager's sign-off.

  Background:
    Given an employee with 12 days of annual leave remaining

  Scenario: Approve a request within the allowance
    When the employee requests 5 days of leave starting on 3 November
    Then the request is approved under the leave policy
    And the employee has 7 days of annual leave remaining

  Scenario: Refuse a request that exceeds the allowance
    When the employee requests 15 days of leave
    Then the request is refused because it exceeds the remaining allowance
    And the employee still has 12 days of annual leave remaining

  Scenario: Hold a request that overlaps a blackout period
    Given the team has a blackout period from 15 to 19 December
    When the employee requests 2 days of leave starting on 18 December
    Then the request waits for the manager's sign-off

  Scenario: Pro-rate the allowance of a new starter
    Given a new starter who joined on 1 October and is still in onboarding
    When the people team calculates the new starter's allowance
    Then the new starter has 6 days of annual leave for the rest of the year
