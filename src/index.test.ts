import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createRouteDefiner, defineRoute } from "./index";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Helpers – tiny mocks for Express req / res / next
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const mockNext: NextFunction = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("defineRoute (default, no extra props)", () => {
  it("passes validated body to handler", async () => {
    const handler = vi.fn();

    const middleware = defineRoute({
      body: z.object({ name: z.string() }),
      handler,
    });

    const req = mockReq({ body: { name: "zodify" } });
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].body).toEqual({ name: "zodify" });
  });

  it("passes validated query to handler", async () => {
    const handler = vi.fn();

    const middleware = defineRoute({
      query: z.object({ page: z.coerce.number() }),
      handler,
    });

    const req = mockReq({ query: { page: "3" } as any });
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].query).toEqual({ page: 3 });
  });

  it("passes validated params to handler", async () => {
    const handler = vi.fn();

    const middleware = defineRoute({
      params: z.object({ id: z.string().uuid() }),
      handler,
    });

    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const req = mockReq({ params: { id: uuid } as any });
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].params).toEqual({ id: uuid });
  });

  it("returns 400 with structured errors on validation failure", async () => {
    const handler = vi.fn();

    const middleware = defineRoute({
      body: z.object({ age: z.number().min(0) }),
      handler,
    });

    const req = mockReq({ body: { age: "not-a-number" } });
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Validation failed",
      })
    );
  });
});

describe("createRouteDefiner (custom extra props)", () => {
  it("allows handler to access extra request properties", async () => {
    const myDefineRoute = createRouteDefiner<{
      user: { id: string; role: string };
    }>();

    const handler = vi.fn();

    const middleware = myDefineRoute({
      body: z.object({ title: z.string() }),
      handler,
    });

    const req = mockReq({
      body: { title: "hello" },
    });
    // Simulate middleware that attaches user
    (req as any).user = { id: "u1", role: "admin" };

    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).toHaveBeenCalledOnce();
    const handlerReq = handler.mock.calls[0][0];
    expect(handlerReq.body).toEqual({ title: "hello" });
    expect(handlerReq.user).toEqual({ id: "u1", role: "admin" });
  });
});

describe("createRouteDefiner (custom onValidationError)", () => {
  it("delegates to custom error handler on validation failure", async () => {
    const customErrorHandler = vi.fn((_error, _req, res, _next) => {
      res.status(422).json({ custom: true });
    });

    const myDefineRoute = createRouteDefiner({
      onValidationError: customErrorHandler,
    });

    const handler = vi.fn();

    const middleware = myDefineRoute({
      body: z.object({ email: z.string().email() }),
      handler,
    });

    const req = mockReq({ body: { email: "nope" } });
    const res = mockRes();

    await middleware(req, res, mockNext);

    expect(handler).not.toHaveBeenCalled();
    expect(customErrorHandler).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
