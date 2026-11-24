import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { loginSchema } from "../lib/schemas";
import { authenticate, getJwtSecret } from "../middleware/auth";

export const authRouter = Router();

/**
 * POST /api/auth/login
 * Validates credentials and returns a signed JWT + user profile with role.
 */
authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const expiresIn = (process.env.JWT_EXPIRES_IN ?? "8h") as jwt.SignOptions["expiresIn"];
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    getJwtSecret(),
    { expiresIn }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's JWT claims.
 */
authRouter.get("/me", authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user });
});
