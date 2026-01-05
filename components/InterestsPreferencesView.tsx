"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, X, Heart, Loader2 } from "lucide-react";

interface InterestsPreferencesViewProps {
    preferences: string[];
    onUpdatePreferences: (newPreferences: string[]) => Promise<void>;
    isLoading?: boolean;
}

export function InterestsPreferencesView({
    preferences,
    onUpdatePreferences,
    isLoading = false,
}: InterestsPreferencesViewProps) {
    const [newPreference, setNewPreference] = useState("");

    const handleAddPreference = async () => {
        if (!newPreference.trim()) return;
        const updated = [...preferences, newPreference.trim()];
        setNewPreference("");
        await onUpdatePreferences(updated);
    };

    const handleRemovePreference = async (index: number) => {
        const updated = preferences.filter((_, i) => i !== index);
        await onUpdatePreferences(updated);
    };

    return (
        <div className="flex flex-col h-full flex-1 min-h-0 bg-white">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-rose-100 rounded-lg">
                        <Heart className="w-4 h-4 text-rose-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900">Interests & preferences</h2>
                        <p className="text-xs text-gray-500">The AI will respect these settings</p>
                    </div>
                </div>
                <Badge variant="outline" className="text-gray-500 bg-white">
                    {preferences.length} total
                </Badge>
            </div>

            <ScrollArea className="flex-1 p-4">
                {preferences.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                            <Heart className="w-6 h-6 text-gray-300" />
                        </div>
                        <p className="text-sm text-gray-500 max-w-[200px]">
                            No preferences added yet. Tell the AI what you like or dislike.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {preferences.map((preference, index) => (
                            <div
                                key={index}
                                className="group flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-white hover:border-rose-200 hover:bg-rose-50/30 transition-all duration-200"
                            >
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                                <span className="text-sm text-gray-700 flex-1 leading-relaxed">
                                    {preference}
                                </span>
                                <button
                                    onClick={() => handleRemovePreference(index)}
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
                        value={newPreference}
                        onChange={(e) => setNewPreference(e.target.value)}
                        placeholder="Add an interest or preference (e.g. No seafood)"
                        onKeyDown={(e) => e.key === "Enter" && handleAddPreference()}
                        disabled={isLoading}
                        className="flex-1 bg-white border-gray-200 focus:ring-rose-500 h-10 rounded-xl"
                    />
                    <Button
                        onClick={handleAddPreference}
                        disabled={isLoading || !newPreference.trim()}
                        className="rounded-xl px-4 h-10 shadow-sm bg-rose-600 hover:bg-rose-700 hover:text-white"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
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
