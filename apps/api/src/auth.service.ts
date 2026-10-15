import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { isEmail } from 'class-validator';
import { databaseEnabled } from './config';
import { PrismaService } from './prisma.service';

export interface AuthUser { id: string; email: string; name: string }
export interface AuthToken { accessToken: string; user: AuthUser }

@Injectable()
export class AuthService {
  private readonly memoryUsers = new Map<string, { user: AuthUser; passwordHash: string }>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private tokenFor(user: AuthUser): AuthToken {
    const secret = process.env.JWT_SECRET ?? 'development-only-secret';
    return { accessToken: jwt.sign({ sub: user.id, email: user.email, name: user.name }, secret, { expiresIn: '2h' }), user };
  }

  async register(email: string, password: string, name: string): Promise<AuthToken> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail) || name.trim().length < 2 || password.length < 8) throw new BadRequestException('Name, valid email, and password of at least 8 characters are required');
    if (databaseEnabled) {
      const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existing) throw new ConflictException('Email is already registered');
      const record = await this.prisma.user.create({ data: { email: normalizedEmail, name: name.trim(), passwordHash: await bcrypt.hash(password, 12) } });
      return this.tokenFor({ id: record.id, email: record.email, name: record.name });
    }
    if ([...this.memoryUsers.values()].some((entry) => entry.user.email === normalizedEmail)) throw new ConflictException('Email is already registered');
    const user = { id: `user-${randomUUID()}`, email: normalizedEmail, name: name.trim() };
    this.memoryUsers.set(user.id, { user, passwordHash: await bcrypt.hash(password, 12) });
    return this.tokenFor(user);
  }

  async login(email: string, password: string): Promise<AuthToken> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmail(normalizedEmail) || password.length < 8) throw new BadRequestException('Valid email and password of at least 8 characters are required');
    const record = databaseEnabled
      ? await this.prisma.user.findUnique({ where: { email: normalizedEmail } }).then((user) => user ? { user: { id: user.id, email: user.email, name: user.name }, passwordHash: user.passwordHash } : undefined)
      : [...this.memoryUsers.values()].find((entry) => entry.user.email === normalizedEmail);
    if (!record || !(await bcrypt.compare(password, record.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    return this.tokenFor(record.user);
  }

  verify(token: string): AuthUser {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'development-only-secret') as { sub: string; email: string; name?: string };
      return { id: payload.sub, email: payload.email, name: payload.name ?? payload.email };
    } catch { throw new UnauthorizedException('Invalid or expired token'); }
  }
}