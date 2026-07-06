import type { Request, Response, NextFunction } from "express";
import type { ZodType, z, ZodError } from "zod";

// ---------------------------------------------------------------------------
// Self-contained handler type (avoids transitive @types/express-serve-static-core)
// ---------------------------------------------------------------------------

/**
 * An Express-compatible middleware function.
 * Defined locally so consumers never need to resolve
 * `@types/express-serve-static-core` transitively — avoids the
 * "inferred type cannot be named" portability error.
 */
export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

type ZodInfer<
  T extends ZodType | undefined,
  TDefault = any,
> = T extends ZodType ? z.infer<T> : TDefault;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export interface ValidationSchemas<
  TBody extends ZodType | undefined = undefined,
  TQuery extends ZodType | undefined = undefined,
  TParams extends ZodType | undefined = undefined,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}

// ---------------------------------------------------------------------------
// Validated request – merges Zod-inferred types with any custom props
// ---------------------------------------------------------------------------

export type ValidatedRequest<
  TBody extends ZodType | undefined,
  TQuery extends ZodType | undefined,
  TParams extends ZodType | undefined,
  TExtra extends Record<string, any> = {},
> = Request<ZodInfer<TParams>, any, ZodInfer<TBody>, ZodInfer<TQuery>> & TExtra;

// ---------------------------------------------------------------------------
// Route config – what the developer passes to `defineRoute`
// ---------------------------------------------------------------------------

export interface RouteConfig<
  TBody extends ZodType | undefined = undefined,
  TQuery extends ZodType | undefined = undefined,
  TParams extends ZodType | undefined = undefined,
  TExtra extends Record<string, any> = {},
> extends ValidationSchemas<TBody, TQuery, TParams> {
  handler: (
    req: ValidatedRequest<TBody, TQuery, TParams, TExtra>,
    res: Response,
    next: NextFunction,
  ) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Options accepted by `createRouteDefiner`
// ---------------------------------------------------------------------------

export interface RouteDefinerOptions {
  /**
   * Custom handler called when Zod validation fails.
   * If omitted, a 400 JSON response with the Zod issues is sent automatically.
   */
  onValidationError?: (
    error: ZodError,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
}

// ---------------------------------------------------------------------------
// Default validation error handler
// ---------------------------------------------------------------------------

const defaultOnValidationError: NonNullable<
  RouteDefinerOptions["onValidationError"]
> = (error, _req, res, _next) => {
  res.status(400).json({
    success: false,
    message: "Validation failed",
    errors: error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    })),
  });
};

// ---------------------------------------------------------------------------
// createRouteDefiner – the factory ✨
// ---------------------------------------------------------------------------

/**
 * Creates a `defineRoute` function whose handler's `req` is automatically
 * augmented with custom properties (e.g. `req.user`, `req.session`, etc.).
 *
 * @example
 * ```ts
 * import { createRouteDefiner } from "zodify-express";
 *
 * // Tell TypeScript what your middleware adds to `req`
 * const defineRoute = createRouteDefiner<{ user: { id: string; role: string } }>();
 *
 * export const getProfile = defineRoute({
 *   params: z.object({ id: z.string().uuid() }),
 *   handler(req, res) {
 *     // req.user   → { id: string; role: string }  ← auto-inferred!
 *     // req.params → { id: string }                 ← Zod-validated!
 *     res.json({ userId: req.user.id, paramId: req.params.id });
 *   },
 * });
 * ```
 */
export function createRouteDefiner<TExtra extends Record<string, any> = {}>(
  options: RouteDefinerOptions = {},
) {
  const onError = options.onValidationError ?? defaultOnValidationError;

  return function defineRoute<
    TBody extends ZodType | undefined = undefined,
    TQuery extends ZodType | undefined = undefined,
    TParams extends ZodType | undefined = undefined,
  >(config: RouteConfig<TBody, TQuery, TParams, TExtra>): RouteHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const validatedReq = req as ValidatedRequest<
        TBody,
        TQuery,
        TParams,
        TExtra
      >;
      try {
        if (config.params) {
          validatedReq.params = (await config.params.parseAsync(
            req.params,
          )) as ZodInfer<TParams>;
        }
        if (config.query) {
          validatedReq.query = (await config.query.parseAsync(
            req.query,
          )) as ZodInfer<TQuery>;
        }
        if (config.body) {
          validatedReq.body = (await config.body.parseAsync(
            req.body,
          )) as ZodInfer<TBody>;
        }
        await config.handler(validatedReq, res, next);
      } catch (error) {
        // If it's a ZodError, delegate to the custom error handler
        if (error && typeof error === "object" && "issues" in error) {
          return onError(error as ZodError, req, res, next);
        }
        next(error);
      }
    };
  };
}

// ---------------------------------------------------------------------------
// Default export – a ready-to-use `defineRoute` with no extra request props
// ---------------------------------------------------------------------------

/**
 * A pre-built `defineRoute` with no additional request properties.
 * Use `createRouteDefiner<{ ... }>()` if you need custom props like `req.user`.
 */
export const defineRoute = createRouteDefiner();
