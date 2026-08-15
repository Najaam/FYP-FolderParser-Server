Feature: Auth
  As a user of the event management system
  I want to register, log in, and view my profile
  So that I can use authenticated features

  Background:
    Given the Auth API is available at base path "/api/auth"

  Scenario: Register a new user successfully
    When a POST request is sent to "/api/auth/register" with fullName "John Doe", email "john@example.com", password "secret123", and role "attendee"
    Then the response status should be 201
    And the response body should have "success" set to true
    And the response body should have "message" set to "User registered successfully"
    And the response body should contain a "user" object with id, fullName, email, role, and createdAt
    And the "user" object should have role "attendee"
    And the response body should contain a "token"

  Scenario: Registration fails when a required field is missing
    When a POST request is sent to "/api/auth/register" without fullName, email, or password
    Then the response status should be 400
    And the response body should have "success" set to false
    And the response body should have "message" set to "Full name, email, and password are required"

  Scenario: Registration fails when the registration service returns an error
    Given the registration service cannot create the user
    When a POST request is sent to "/api/auth/register" with fullName "John Doe", email "john@example.com", and password "secret123"
    Then the response status should be 400
    And the response body should have "success" set to false
    And the response body should contain the error message from the service

  Scenario: Login with valid credentials
    When a POST request is sent to "/api/auth/login" with email "john@example.com" and password "secret123"
    Then the response status should be 200
    And the response body should have "success" set to true
    And the response body should have "message" set to "Login successful"
    And the response body should contain a "user" object with id, fullName, email, role, and createdAt
    And the response body should contain a "token"

  Scenario: Login fails when email or password is missing
    When a POST request is sent to "/api/auth/login" without email or password
    Then the response status should be 400
    And the response body should have "success" set to false
    And the response body should have "message" set to "Email and password are required"

  Scenario: Login fails when credentials are invalid
    Given the login service rejects the provided credentials
    When a POST request is sent to "/api/auth/login" with email "john@example.com" and password "wrongpassword"
    Then the response status should be 401
    And the response body should have "success" set to false
    And the response body should contain the error message from the service

  Scenario: View profile for an authenticated user
    Given the request includes an authenticated user with id "user123"
    When a GET request is sent to "/api/auth/profile"
    Then the response status should be 200
    And the response body should have "success" set to true
    And the response body should contain the profile data for the authenticated user

  Scenario: View profile fails when the profile service returns an error
    Given the profile service cannot load the user profile
    And the request includes an authenticated user with id "user123"
    When a GET request is sent to "/api/auth/profile"
    Then the response status should be 500
    And the response body should have "success" set to false
    And the response body should contain the error message from the service