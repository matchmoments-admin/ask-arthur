import { describe, it, expect, vi } from "vitest";
import * as tls from "tls";

// Mock tls.connect to avoid real network calls
vi.mock("tls", () => {
  const EventEmitter = require("events");
  return {
    connect: vi.fn(() => {
      const socket = new EventEmitter();
      socket.destroy = vi.fn();
      return socket;
    }),
  };
});

import {
  checkTLS12,
  checkTLS13,
  checkTLS10Absent,
  checkTLS11Absent,
} from "../checks/tls-version";

function simulateConnect(success: boolean) {
  const EventEmitter = require("events");
  vi.mocked(tls.connect).mockImplementation((...args: unknown[]) => {
    const socket = new EventEmitter();
    socket.destroy = vi.fn();
    setTimeout(() => {
      if (success) {
        // Find the callback (last argument that's a function)
        const callback = args.find((a) => typeof a === "function") as Function;
        if (callback) callback();
      } else {
        socket.emit("error", new Error("Connection refused"));
      }
    }, 0);
    return socket;
  });
}

describe("checkTLS12", () => {
  it("passes when TLS 1.2 connects", async () => {
    simulateConnect(true);
    const result = await checkTLS12("example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(10);
  });

  it("fails when TLS 1.2 does not connect", async () => {
    simulateConnect(false);
    const result = await checkTLS12("example.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkTLS13", () => {
  it("passes when TLS 1.3 connects", async () => {
    simulateConnect(true);
    const result = await checkTLS13("example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("warns when TLS 1.3 does not connect", async () => {
    simulateConnect(false);
    const result = await checkTLS13("example.com");
    expect(result.status).toBe("warn");
    expect(result.score).toBe(0);
  });
});

describe("checkTLS10Absent", () => {
  it("passes when TLS 1.0 is rejected", async () => {
    simulateConnect(false);
    const result = await checkTLS10Absent("example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("fails when TLS 1.0 connects", async () => {
    simulateConnect(true);
    const result = await checkTLS10Absent("example.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});

describe("checkTLS11Absent", () => {
  it("passes when TLS 1.1 is rejected", async () => {
    simulateConnect(false);
    const result = await checkTLS11Absent("example.com");
    expect(result.status).toBe("pass");
    expect(result.score).toBe(5);
  });

  it("fails when TLS 1.1 connects", async () => {
    simulateConnect(true);
    const result = await checkTLS11Absent("example.com");
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});
