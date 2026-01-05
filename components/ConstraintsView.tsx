"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, X, ListChecks, Loader2 } from "lucide-react";

interface ConstraintsViewProps {
    constraints: string[];
    onUpdateConstraints: (newConstraints: string[]) => Promise<void>;
    isLoading?: boolean;
}

export function ConstraintsView({
    constraints,
    onUpdateConstraints,
    isLoading = false,
}: ConstraintsViewProps) {
    const [newConstraint, setNewConstraint] = useState("");

    const handleAddConstraint = async () => {
        if (!newConstraint.trim()) return;
        const updated = [...constraints, newConstraint.trim()];
        setNewConstraint("");
        await onUpdateConstraints(updated);
    };

    const handleRemoveConstraint = async (index: number) => {
        const updated = constraints.filter((_, i) => i !== index);
        await onUpdateConstraints(updated);
    };

    return (
        <div className="flex flex-col h-full flex-1 min-h-0 bg-white">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-100 rounded-lg">
                        <ListChecks className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900">Trip Constraints</h2>
                        <p className="text-xs text-gray-500">The AI will respect these preferences</p>
                    </div>
                </div>
                <Badge variant="outline" className="text-gray-500 bg-white">
                    {constraints.length} total
                </Badge>
            </div>

            <ScrollArea className="flex-1 p-4">
                {constraints.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                            <ListChecks className="w-6 h-6 text-gray-300" />
                        </div>
                        <p className="text-sm text-gray-500 max-w-[200px]">
                            No constraints added yet. Tell the AI what matters most for your trip.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {constraints.map((constraint, index) => (
                            <div
                                key={index}
                                className="group flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-all duration-200"
                            >
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                                <span className="text-sm text-gray-700 flex-1 leading-relaxed">
                                    {constraint}
                                </span>
                                <button
                                    onClick={() => handleRemoveConstraint(index)}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                                    disabled={isLoading}
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            <div className="p-4 border-t border-gray-100 bg-gray-50/30">
                <div className="flex gap-2">
                    <Input
                        value={newConstraint}
                        onChange={(e) => setNewConstraint(e.target.value)}
                        placeholder="Add a constraint (e.g. No seafood)"
                        onKeyDown={(e) => e.key === "Enter" && handleAddConstraint()}
                        disabled={isLoading}
                        className="flex-1 bg-white border-gray-200 focus:ring-blue-500 h-10 rounded-xl"
                    />
                    <Button
                        onClick={handleAddConstraint}
                        disabled={isLoading || !newConstraint.trim()}
                        className="rounded-xl px-4 h-10 shadow-sm"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                <Plus className="w-4 h-4 mr-2" />
                                Add
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}
