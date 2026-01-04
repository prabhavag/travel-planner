"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plane } from "lucide-react";

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleStart = () => {
    setLoading(true);
    router.push("/planner");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-md mx-auto px-5 py-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Plane className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Travel Planner
          </h1>
          <p className="text-gray-600">
            Your AI-powered travel planning assistant
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <p className="text-lg text-gray-600 leading-7 text-center">
            Welcome! Let&apos;s plan your next adventure together. Tell me about your
            destination, dates, and interests, and I&apos;ll create a personalized
            itinerary just for you.
          </p>
        </div>

        <Separator className="my-6" />

        <Button
          onClick={handleStart}
          disabled={loading}
          size="lg"
          className="w-full h-14 rounded-full text-lg"
        >
          {loading ? "Loading..." : "Start Planning with AI"}
        </Button>
      </div>
    </div>
  );
}
