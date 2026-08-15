// Auto-generated sandbox source file for DevSure test execution.

// This file is written inside the backend project's sandbox folder.

// It is overwritten on every generation/execution.


// Safe dynamic dependency mocks for sandbox execution.
// Imported or referenced services/helpers are converted into mocks automatically.

function createMockUser(overrides = {}) {
  return {
    _id: "123",
    id: "123",
    fullName: "John Doe",
    name: "John Doe",
    email: "john@example.com",
    role: "user",
    createdAt: new Date(),
    ...overrides
  };
}

function createMockVenue(overrides = {}) {
  return {
    _id: "venue123",
    id: "venue123",
    name: "Grand Hall",
    description: "A premium event venue",
    location: "Karachi",
    capacity: 200,
    pricePerHour: 5000,
    amenities: ["Parking", "AC", "WiFi"],
    images: ["venue.jpg"],
    createdBy: "user123",
    ...overrides
  };
}

function createMockBooking(overrides = {}) {
  return {
    _id: "booking123",
    id: "booking123",
    venue: "venue123",
    user: "user123",
    date: "2026-01-01",
    startTime: "10:00",
    endTime: "12:00",
    status: "pending",
    totalAmount: 10000,
    ...overrides
  };
}

function createMockPayment(overrides = {}) {
  return {
    _id: "payment123",
    id: "payment123",
    booking: "booking123",
    amount: 10000,
    status: "paid",
    method: "card",
    ...overrides
  };
}

function createDomainMock(serviceName, payload = {}) {
  if (/venue/i.test(serviceName)) {
    return createMockVenue(payload);
  }

  if (/booking/i.test(serviceName)) {
    return createMockBooking(payload);
  }

  if (/payment/i.test(serviceName)) {
    return createMockPayment(payload);
  }

  return createMockUser(payload);
}

function createAutoMockFunction(name) {
  return jest.fn((...args) => {
    if (/token/i.test(name)) {
      return "mock-token";
    }

    if (/id/i.test(name)) {
      return "123";
    }

    if (/hash/i.test(name)) {
      return "mock-hash";
    }

    if (/compare/i.test(name)) {
      return true;
    }

    return "mock-value";
  });
}

function createAutoMockService(serviceName) {
  const serviceTarget = {};

  return new Proxy(serviceTarget, {
    get(target, property) {
      if (property in target) {
        return target[property];
      }

      const methodName = String(property);

      target[property] = jest.fn(async (payload = {}) => {
        const id =
          typeof payload === "string"
            ? payload
            : payload?._id ||
              payload?.id ||
              payload?.userId ||
              payload?.venueId ||
              "123";

        if (/getAll|findAll|list|fetchAll/i.test(methodName)) {
          return [createDomainMock(serviceName)];
        }

        if (/get.*ById|find.*ById|getProfile|profile|details/i.test(methodName)) {
          if (!id || id === "invalid" || id === "not-found") {
            if (/profile/i.test(methodName)) {
              throw new Error("User not found");
            }

            return null;
          }

          return createDomainMock(serviceName, { _id: id, id });
        }

        if (/create|register|add/i.test(methodName)) {
          if (payload?.role === "admin" && /auth/i.test(serviceName)) {
            throw new Error("Invalid role");
          }

          return createDomainMock(serviceName, payload);
        }

        if (/login|signin/i.test(methodName)) {
          if (
            payload?.email === "invalid-email" ||
            payload?.password === "wrong-password"
          ) {
            throw new Error("Authentication failed");
          }

          return createMockUser({
            email: payload?.email || "john@example.com"
          });
        }

        if (/update|edit/i.test(methodName)) {
          if (!id || id === "not-found") {
            if (/venue/i.test(serviceName)) {
              throw new Error("Venue not found");
            }

            throw new Error("Record not found");
          }

          return createDomainMock(serviceName, {
            _id: id,
            id,
            ...payload
          });
        }

        if (/delete|remove/i.test(methodName)) {
          if (!id || id === "not-found") {
            return false;
          }

          return true;
        }

        if (/cancel/i.test(methodName)) {
          if (!id || id === "not-found") {
            throw new Error("Record not found");
          }

          return {
            success: true,
            message: "Cancelled successfully"
          };
        }

        return {
          success: true,
          message: "mock success",
          data: createDomainMock(serviceName, payload)
        };
      });

      return target[property];
    }
  });
}

const authService = createAutoMockService("authService");
const generateToken = createAutoMockFunction("generateToken");

const fs = {
  promises: {
    readFile: jest.fn(async () => ""),
    writeFile: jest.fn(async () => undefined),
    mkdir: jest.fn(async () => undefined),
    readdir: jest.fn(async () => []),
    stat: jest.fn(async () => ({ isDirectory: () => false, isFile: () => true }))
  },
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isDirectory: () => true, isFile: () => false })),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(() => "")
};

const path = require("path");

const fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true }),
  text: async () => "mock text"
}));


const register = async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and password are required"
      });
    }

    const user = await authService.registerUser({
      fullName,
      email,
      password,
      role
    });

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt
        },
        token
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const user = await authService.loginUser({ email, password });
    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt
        },
        token
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message
    });
  }
};

const profile = async (req, res) => {
  try {
    const user = await authService.getProfile(req.user._id);

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


module.exports = module.exports || {};


if (typeof authService !== "undefined") {
  module.exports.authService = authService;
}

if (typeof generateToken !== "undefined") {
  module.exports.generateToken = generateToken;
}


if (typeof register !== "undefined") {
  module.exports.register = register;
}

if (typeof login !== "undefined") {
  module.exports.login = login;
}

if (typeof profile !== "undefined") {
  module.exports.profile = profile;
}