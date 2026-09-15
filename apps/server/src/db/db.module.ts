import { type DynamicModule, Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type DbHandle } from "@albion-hub/db";

export const DB_HANDLE = Symbol("DB_HANDLE");

@Global()
@Module({})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  static register(databaseUrl: string): DynamicModule {
    return {
      module: DbModule,
      providers: [{ provide: DB_HANDLE, useFactory: () => createDb(databaseUrl) }],
      exports: [DB_HANDLE],
    };
  }

  async onApplicationShutdown() {
    await this.handle.close();
  }
}
