import "./App.css";
import { useEffect, useMemo, useState } from "react";
import { db } from "./db";
import type { ExpenseRow, BudgetRow } from "./db";
import {
  addMonths,
  currentMonthKey,
  formatMonthLabel,
  monthKeyFromDate,
  todayISO,
} from "./utils/month";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type ImportExportShape = {
  version: number;
  exportedAt: string;
  expenses: ExpenseRow[];
  budgets: BudgetRow[];
};

const CATEGORIES = [
  "Food",
  "Rent",
  "Transport",
  "Bills",
  "Shopping",
  "Entertainment",
  "Other",
] as const;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function App() {
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey());

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [budget, setBudget] = useState<number | null>(null);

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [category] =
    useState<(typeof CATEGORIES)[number]>("Food");
  const [note, setNote] = useState("");

  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("All");
  const [status, setStatus] = useState<string>("");

  async function loadMonth(monthKey: string) {
    const list = await db.expenses
      .where("monthKey")
      .equals(monthKey)
      .sortBy("date");
    setRows(list.reverse());

    const b = await db.budgets.get(monthKey);
    setBudget(b?.amount ?? null);
  }

  useEffect(() => {
    loadMonth(selectedMonthKey);
  }, [selectedMonthKey]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""),2000);
    return () => clearTimeout(t);
  },[status]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchCat = catFilter === "All" ? true : r.category === catFilter;
      const matchSearch =
        q.length === 0
          ? true
          : (r.note ?? "").toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q) ||
            r.date.includes(q);
      return matchCat && matchSearch;
    });
  }, [rows, search, catFilter]);

  const totalFiltered = useMemo(
    () => filteredRows.reduce((s, r) => s + r.amount, 0),
    [filteredRows]
  );
  const totalAll = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const remaining = useMemo(() => {
    if (budget == null) return null;
    return budget - totalAll;
  }, [budget, totalAll]);

  const byCategoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.category, (map.get(r.category) ?? 0) + r.amount);
    }
    return Array.from(map.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();

    const amt = Number(amount);
    if (!date || !Number.isFinite(amt) || amt <= 0) {
      setStatus("Enter a valid date and a positive amount.");
      return;
    }

    const monthKey = monthKeyFromDate(date);

    await db.expenses.add({
      monthKey,
      date,
      amount: amt,
      category,
      note: note.trim() ? note.trim() : undefined,
      createdAt: Date.now(),
    });

    setAmount("");
    setNote("");
    setStatus("Added.");
    setSelectedMonthKey(monthKey);
    await loadMonth(monthKey);
  }

  async function onDelete(id?: number) {
    if (!id) return;
    await db.expenses.delete(id);
    setStatus("Deleted.");
    await loadMonth(selectedMonthKey);
  }

  async function onSaveEdit() {
    if (!editing?.id) return;

    const amt = Number(editing.amount);
    if (!editing.date || !Number.isFinite(amt) || amt <= 0) {
      setStatus("Edit failed: invalid date/amount.");
      return;
    }

    const newMonthKey = monthKeyFromDate(editing.date);

    await db.expenses.update(editing.id, {
      date: editing.date,
      amount: amt,
      category: editing.category,
      note: editing.note?.trim() ? editing.note.trim() : undefined,
      monthKey: newMonthKey,
    });

    setEditing(null);
    setStatus("Updated.");
    setSelectedMonthKey(newMonthKey);
    await loadMonth(newMonthKey);
  }

  async function onSetBudget(value: string) {
    const b = Number(value);
    if (!Number.isFinite(b) || b < 0) {
      setStatus("Budget must be 0 or more.");
      return;
    }

    await db.budgets.put({
      monthKey: selectedMonthKey,
      amount: b,
      updatedAt: Date.now(),
    });

    setBudget(b);
    setStatus("Budget saved.");
  }

  async function exportJSON() {
    const expenses = await db.expenses.toArray();
    const budgets = await db.budgets.toArray();

    const payload: ImportExportShape = {
      version: 1,
      exportedAt: new Date().toISOString(),
      expenses,
      budgets,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expense_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setStatus("Exported JSON backup.");
  }

  async function importJSON(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<ImportExportShape>;

      if (!parsed || !Array.isArray(parsed.expenses) || !Array.isArray(parsed.budgets)) {
        setStatus("Import failed: JSON format not recognized.");
        return;
      }

      const expenses = parsed.expenses.filter((e) =>
        typeof e.date === "string" &&
        typeof e.monthKey === "string" &&
        typeof e.amount === "number" &&
        typeof e.category === "string" &&
        typeof e.createdAt === "number"
      );

      const budgets = parsed.budgets.filter((b) =>
        typeof b.monthKey === "string" &&
        typeof b.amount === "number" &&
        typeof b.updatedAt === "number"
      );

      await db.transaction("rw", db.expenses, db.budgets, async () => {
        await db.expenses.clear();
        await db.budgets.clear();
        await db.expenses.bulkPut(expenses);
        await db.budgets.bulkPut(budgets);
      });

      setStatus(`Imported. Loaded ${expenses.length} expenses and ${budgets.length} budgets.`);
      await loadMonth(selectedMonthKey);
    } catch {
      setStatus("Import failed: invalid JSON file.");
    }
  }

  async function clearSelectedMonth() {
    await db.expenses.where("monthKey").equals(selectedMonthKey).delete();
    setStatus("Cleared selected month expenses.");
    await loadMonth(selectedMonthKey);
  }

  const budgetStatus = useMemo(() => {
    if (budget == null) return "No budget set";
    if (remaining == null) return "No budget set";
    if (remaining >= 0) return `Remaining: ${money(remaining)}`;
    return `Over budget by: ${money(Math.abs(remaining))}`;
  }, [budget, remaining]);

  return (
    <div className="page">
      <div className="container">
        <div className="heroTop">
         <div className="title">
           <div className="logo" />
          <div>
        <h1 className="h1">Expense Tracker</h1>
        <div className="sub">Fast • Offline-first • Clean analytics</div>
      </div>
    </div>

    <div className="row">
      <button className="btn btn-ghost" onClick={() => setSelectedMonthKey(addMonths(selectedMonthKey, -1))}>
        ← Prev
      </button>

      <div className="badge">{formatMonthLabel(selectedMonthKey)}</div>

      <button className="btn btn-ghost" onClick={() => setSelectedMonthKey(addMonths(selectedMonthKey, 1))}>
        Next →
      </button>
    </div>

    <div className="row">
      <button className="btn btnPrimary" onClick={exportJSON}>Export</button>

      <label className="btn" style={{ display: "inline-flex", alignItems: "center" }}>
        Import
        <input
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJSON(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  </div>
</div>
      {status && (
        <div className="toastWrap">
          <div className="toast">{status}</div>
        </div>
      )}

      <div style={{ display: "grid", gap: 10, marginBottom: 16, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
        <strong>Budget (month):</strong>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder={budget == null ? "Set budget" : String(budget)}
            defaultValue={budget ?? ""}
            onBlur={(e) => onSetBudget(e.target.value)}
          />
          <span style={{ opacity: 0.85 }}>
            Total (all items): <strong>{money(totalAll)}</strong>
          </span>
          <span style={{ opacity: 0.85 }}>{budgetStatus}</span>
          <button style={{ marginLeft: "auto" }} onClick={clearSelectedMonth}>
            Clear month
          </button>
       </div>

      <form onSubmit={onAdd} style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.01"
            min="0"
          />
          <select
  value={editing?.category ?? "Food"}
  onChange={(e) => {
    if (!editing) return;
    setEditing({
      ...editing,
      category: e.target.value as ExpenseRow["category"],
    });
  }}
>

            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            style={{ flex: 1, minWidth: 240 }}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit">Add</button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          style={{ flex: 1, minWidth: 260 }}
          placeholder="Search (note, category, date)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div style={{ opacity: 0.85 }}>
          Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> items
        </div>
        <div style={{ opacity: 0.85 }}>
          Filtered total: <strong>{money(totalFiltered)}</strong>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Totals by Category</h3>

          {byCategoryData.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No data yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", paddingBottom: 8 }}>Category</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", paddingBottom: 8 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {byCategoryData.map((d) => (
                  <tr key={d.category}>
                    <td style={{ padding: "8px 0" }}>{d.category}</td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}>{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Category Chart</h3>
          {byCategoryData.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No data yet.</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={byCategoryData}>
                  <XAxis dataKey="category" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="total" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {filteredRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No expenses match the current view.</div>
        ) : (
          filteredRows.map((r) => (
            <div key={r.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div>
                    <strong>{money(r.amount)}</strong> — {r.category}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    {r.date}{r.note ? ` • ${r.note}` : ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEditing({ ...r })}>Edit</button>
                  <button onClick={() => onDelete(r.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{ width: "min(720px, 100%)", background: "white", borderRadius: 12, padding: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Edit Expense</h3>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={editing.date}
                  onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={String(editing.amount)}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                />
                <select
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>

              <input
                placeholder="Note (optional)"
                value={editing.note ?? ""}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setEditing(null)}>Cancel</button>
                <button onClick={onSaveEdit}>Save</button>
              </div>

              <div style={{ fontSize: 13, opacity: 0.8 }}>
                If you change the date to a different month, the item automatically moves to that month.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
