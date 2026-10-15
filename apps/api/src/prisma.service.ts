import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { databaseEnabled } from './config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { if (databaseEnabled) await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}