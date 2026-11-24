import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

export interface AuthUser {
  userId: string;
  email: string;
  role: Role;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? "change_me_in_production_use_a_long_random_string";
}

/**
 * Verifies the Bearer JWT in the Authorization header and attaches `req.user`.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Missing JWT token" });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser;
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      name: payload.name,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Enforces strict role-based access control.
 * Must be placed after `authenticate`.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: "Forbidden: insufficient role permissions",
        requiredRoles: roles,
        currentRole: req.user.role,
      });
      return;
    }

    next();
  };
}
