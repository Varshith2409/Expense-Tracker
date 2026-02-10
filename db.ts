import Dexie from "dexie";
import type { Table } from "dexie";

export type ExpenseRow = {
  id?: number;
  monthKey: string;   // "YYYY-MM"
  date: string;       // "YYYY-MM-DD"
  amount: number;
  category: string;
  note?: string;
  createdAt: number;
};

export type BudgetRow = {
  monthKey: string;   // primary key
  amount: number;
  updatedAt: number;
};

class ExpenseDB extends Dexie {
  expenses!: Table<ExpenseRow, number>;
  budgets!: Table<BudgetRow, string>;

  constructor() {
    super("ExpenseDB");

    // v1
    this.version(1).stores({
      expenses: "++id, monthKey, date, category, createdAt",
    });

    // v2 (adds budgets table)
    this.version(2).stores({
      expenses: "++id, monthKey, date, category, createdAt",
      budgets: "&monthKey, updatedAt",
    });
  }
}

export const db = new ExpenseDB();
