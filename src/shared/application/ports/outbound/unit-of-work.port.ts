export const UNIT_OF_WORK_PORT = Symbol("UNIT_OF_WORK_PORT");

export interface UnitOfWorkPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

