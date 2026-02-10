import type { ExpenseRow, BudgetRow } from "./db";

export type StoreShape = {
  expenses: ExpenseRow[];
  budgets: BudgetRow[];
};
