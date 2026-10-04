Feature: Auth
  Auth API supports user registration, login, and profile retrieval.

  Scenario: Register a new user successfully
    Given the auth service can create a user with the provided details
    When a POST request is sent to "/api/auth/register" with body:
      | fullName | John Doe |
      | email | john@example.com |
      | password | secret123 |
      | role | user |
    Then the response status should be 201
    And the response body should have success true
    And the response message should be "User registered successfully"
    And the response data.user should contain id, fullName, email, role, and createdAt
    And the response data should contain a token

  Scenario: Reject registration when full name is missing
    Given the request body contains email and password but no fullName
    When a POST request is sent to "/api/auth/register"
    Then the response status should be 400
    And the response body should have success false
    And the response message should be "Full name, email, and password are required"

  Scenario: Reject registration when email is missing
    Given the request body contains fullName and password but no email
    When a POST request is sent to "/api/auth/register"
    Then the response status should be 400
    And the response body should have success false
    And the response message should be "Full name, email, and password are required"

  Scenario: Reject registration when password is missing
    Given the request body contains fullName and email but no password
    When a POST request is sent to "/api/auth/register"
    Then the response status should be 400
    And the response body should have success false
    And the response message should be "Full name, email, and password are required"

  Scenario: Handle registration service failure
    Given the auth service fails to register the user with an error
    When a POST request is sent to "/api/auth/register" with valid fullName, email, and password
    Then the response status should be 400
    And the response body should have success false
    And the response message should be the error message from the auth service

  Scenario: Login with valid credentials
    Given the auth service can authenticate the user with the provided email and password
    When a POST request is sent to "/api/auth/login" with body:
      | email | john@example.com |
      | password | secret123 |
    Then the response status should be 200
    And the response body should have success true
    And the response message should be "Login successful"
    And the response data.user should contain id, fullName, email, role, and createdAt
    And the response data should contain a token

  Scenario: Reject login when email is missing
    Given the request body contains password but no email
    When a POST request is sent to "/api/auth/login"
    Then the response status should be 400
    And the response body should have success false
    And the response message should be "Email and password are required"

  Scenario: Reject login when password is missing
    Given the request body contains email but no password
    When a POST request is sent to "/api/auth/login"
    Then the response status should be 400
    And the response body should have success false
    And the response message should be "Email and password are required"

  Scenario: Handle login failure with invalid credentials
    Given the auth service cannot authenticate the user with the provided credentials
    When a POST request is sent to "/api/auth/login" with body:
      | email | john@example.com |
      | password | wrongpassword |
    Then the response status should be 401
    And the response body should have success false
    And the response message should be the error message from the auth service

  Scenario: View profile with valid authentication
    Given an authenticated user exists
    And the auth service can retrieve the profile for that user
    When a GET request is sent to "/api/auth/profile" with the user's authentication token
    Then the response status should be 200
    And the response body should have success true
    And the response data should contain the user profile returned by the auth service

  Scenario: Handle profile retrieval failure
    Given an authenticated user exists
    And the auth service fails to retrieve the profile for that user
    When a GET request is sent to "/api/auth/profile" with the user's authentication token
    Then the response status should be 500
    And the response body should have success false
    And the response message should be the error message from the auth service