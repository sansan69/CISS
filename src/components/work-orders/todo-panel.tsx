"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Clock, AlertCircle, Plus, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import type { WorkOrderTodo, WorkOrderTodoPriority, WorkOrderTodoStatus } from "@/types/work-orders";

const STATUS_CONFIG: Record<WorkOrderTodoStatus, { label: string; icon: React.ElementType; color: string }> = {
  pending: { label: "Pending", icon: Circle, color: "bg-slate-100 text-slate-700 border-slate-200" },
  "in-progress": { label: "In Progress", icon: Clock, color: "bg-blue-100 text-blue-700 border-blue-200" },
  completed: { label: "Completed", icon: CheckCircle2, color: "bg-green-100 text-green-700 border-green-200" },
  cancelled: { label: "Cancelled", icon: X, color: "bg-gray-100 text-gray-500 border-gray-200" },
};

const PRIORITY_CONFIG: Record<WorkOrderTodoPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700" },
  high: { label: "High", color: "bg-orange-100 text-orange-700" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700" },
};

interface WorkOrderTodoPanelProps {
  workOrderId?: string;
  siteId?: string;
  siteName?: string;
  examName?: string;
  district?: string;
}

export default function WorkOrderTodoPanel({
  workOrderId,
  siteId,
  siteName,
  examName,
  district,
}: WorkOrderTodoPanelProps) {
  const [todos, setTodos] = useState<WorkOrderTodo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState<WorkOrderTodoPriority>("medium");
  const [filterStatus, setFilterStatus] = useState<WorkOrderTodoStatus | "all">("all");
  const { toast } = useToast();

  const fetchTodos = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (workOrderId) params.set("workOrderId", workOrderId);
      if (siteId) params.set("siteId", siteId);

      const res = await authorizedFetch(`/api/admin/work-orders/todos?${params.toString()}`);
      const data = await res.json();
      setTodos(data.todos || []);
    } catch (error: any) {
      console.error("Failed to fetch todos:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not load todos." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, [workOrderId, siteId]);

  const filteredTodos = useMemo(() => {
    if (filterStatus === "all") return todos;
    return todos.filter((t) => t.status === filterStatus);
  }, [todos, filterStatus]);

  const stats = useMemo(() => {
    return {
      total: todos.length,
      pending: todos.filter((t) => t.status === "pending").length,
      inProgress: todos.filter((t) => t.status === "in-progress").length,
      completed: todos.filter((t) => t.status === "completed").length,
    };
  }, [todos]);

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast({ variant: "destructive", title: "Title required" });
      return;
    }

    setIsCreating(true);
    try {
      const res = await authorizedFetch("/api/admin/work-orders/todos", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          priority: newPriority,
          workOrderId: workOrderId || null,
          siteId: siteId || null,
          siteName: siteName || "",
          examName: examName || "",
          district: district || "",
        }),
      });

      if (!res.ok) throw new Error("Create failed");

      toast({ title: "Todo created" });
      setNewTitle("");
      setNewDescription("");
      setNewPriority("medium");
      setShowForm(false);
      fetchTodos();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Could not create todo." });
    } finally {
      setIsCreating(false);
    }
  };

  const handleStatusChange = async (todoId: string, newStatus: WorkOrderTodoStatus) => {
    try {
      const res = await authorizedFetch(`/api/admin/work-orders/todos/${todoId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error("Update failed");

      setTodos((prev) =>
        prev.map((t) =>
          t.id === todoId
            ? { ...t, status: newStatus }
            : t
        )
      );
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: "Could not update status." });
    }
  };

  const handleDelete = async (todoId: string) => {
    try {
      const res = await authorizedFetch(`/api/admin/work-orders/todos/${todoId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Delete failed");

      setTodos((prev) => prev.filter((t) => t.id !== todoId));
      toast({ title: "Todo deleted" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: "Could not delete todo." });
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-center">
          <p className="text-lg font-bold leading-none">{stats.total}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Total</p>
        </div>
        <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-center">
          <p className="text-lg font-bold leading-none text-slate-700">{stats.pending}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Pending</p>
        </div>
        <div className="rounded-md border bg-blue-50 px-2 py-1.5 text-center">
          <p className="text-lg font-bold leading-none text-blue-700">{stats.inProgress}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">In Progress</p>
        </div>
        <div className="rounded-md border bg-green-50 px-2 py-1.5 text-center">
          <p className="text-lg font-bold leading-none text-green-700">{stats.completed}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Done</p>
        </div>
      </div>

      {/* Filter + Add */}
      <div className="flex items-center gap-2">
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as WorkOrderTodoStatus | "all")}>
          <SelectTrigger className="h-8 text-xs w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {showForm ? "Cancel" : "Add Task"}
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Task Title</Label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Assign guards for SBI exam"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Additional details..."
              className="text-sm min-h-[60px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <Select value={newPriority} onValueChange={(v) => setNewPriority(v as WorkOrderTodoPriority)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleCreate} disabled={isCreating}>
              {isCreating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              Create
            </Button>
          </div>
        </div>
      )}

      {/* Todo List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTodos.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          {filterStatus === "all" ? "No tasks yet. Add one above." : `No ${filterStatus} tasks.`}
        </div>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {filteredTodos.map((todo) => {
              const statusConfig = STATUS_CONFIG[todo.status];
              const priorityConfig = PRIORITY_CONFIG[todo.priority];
              const StatusIcon = statusConfig.icon;

              return (
                <div
                  key={todo.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    todo.status === "completed" ? "bg-muted/20 opacity-70" : "bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <button
                        onClick={() =>
                          handleStatusChange(
                            todo.id,
                            todo.status === "completed" ? "pending" : "completed"
                          )
                        }
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <StatusIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium leading-tight ${
                            todo.status === "completed" ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {todo.title}
                        </p>
                        {todo.description && (
                          <p className="text-xs text-muted-foreground mt-1">{todo.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityConfig.color}`}>
                            {priorityConfig.label}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusConfig.color}`}>
                            {statusConfig.label}
                          </Badge>
                          {todo.district && (
                            <span className="text-[10px] text-muted-foreground">{todo.district}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(todo.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Status actions */}
                  {todo.status !== "completed" && todo.status !== "cancelled" && (
                    <div className="mt-2 flex gap-1.5">
                      {todo.status !== "in-progress" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleStatusChange(todo.id, "in-progress")}
                        >
                          <Clock className="mr-1 h-3 w-3" />
                          Start
                        </Button>
                      )}
                      {todo.status !== "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleStatusChange(todo.id, "pending")}
                        >
                          <Circle className="mr-1 h-3 w-3" />
                          Mark Pending
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={() => handleStatusChange(todo.id, "completed")}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Complete
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
