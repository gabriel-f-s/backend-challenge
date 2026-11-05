import { AsyncLocalStorage } from "node:async_hooks";
import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import type { UnitOfWorkPort } from "@shared/application/ports/outbound/unit-of-work.port";

const transactionStorage = new AsyncLocalStorage<EntityManager>();

export function resolveActiveEntityManager(rootEntityManager: EntityManager): EntityManager {
  return transactionStorage.getStore() ?? rootEntityManager.getContext();
}

@Injectable()
export class MikroOrmUnitOfWorkAdapter implements UnitOfWorkPort {
  constructor(private readonly entityManager: EntityManager) {}

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    const activeTransactionEm = transactionStorage.getStore();
    if (activeTransactionEm) {
      return activeTransactionEm.transactional(async (nestedEm) => {
        return transactionStorage.run(nestedEm, work);
      });
    }

    const forkedEm = this.entityManager.fork({ clear: true });
    return forkedEm.transactional(async (transactionalEm) => {
      return transactionStorage.run(transactionalEm, work);
    });
  }
}

