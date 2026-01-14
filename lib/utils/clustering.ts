import { type SuggestedActivity, type Coordinates } from "@/lib/models/travel-plan";

/**
 * Calculates the Euclidean distance between two coordinates.
 * Using simple Euclidean distance for city-scale activities is typically sufficient
 * and much faster than Haversine for clustering purposes.
 */
function calculateDistance(a: Coordinates, b: Coordinates): number {
    return Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2));
}

/**
 * Basic K-Means clustering implementation for geographic coordinates.
 */
export function kMeansClustering(
    points: { id: string; coordinates: Coordinates }[],
    k: number,
    maxIterations = 100
): Record<number, string[]> {
    if (points.length === 0) return {};
    if (k <= 0) return { 0: points.map(p => p.id) };
    if (k >= points.length) {
        return points.reduce((acc, p, i) => ({ ...acc, [i]: [p.id] }), {});
    }

    // 1. Initialize centroids (using Forgy Method: random points from the dataset)
    let centroids: Coordinates[] = [...points]
        .sort(() => 0.5 - Math.random())
        .slice(0, k)
        .map(p => ({ ...p.coordinates }));

    let assignments: number[] = new Array(points.length).fill(-1);
    let changed = true;
    let iterations = 0;

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        // 2. Assignment step: assign each point to the nearest centroid
        points.forEach((point, idx) => {
            let minDistance = Infinity;
            let clusterIdx = -1;

            centroids.forEach((centroid, cIdx) => {
                const dist = calculateDistance(point.coordinates, centroid);
                if (dist < minDistance) {
                    minDistance = dist;
                    clusterIdx = cIdx;
                }
            });

            if (assignments[idx] !== clusterIdx) {
                assignments[idx] = clusterIdx;
                changed = true;
            }
        });

        // 3. Update step: recalculate centroids based on the mean of points in the cluster
        const newCentroids: Coordinates[] = new Array(k).fill(null).map(() => ({ lat: 0, lng: 0 }));
        const counts: number[] = new Array(k).fill(0);

        points.forEach((point, idx) => {
            const cIdx = assignments[idx];
            newCentroids[cIdx].lat += point.coordinates.lat;
            newCentroids[cIdx].lng += point.coordinates.lng;
            counts[cIdx]++;
        });

        for (let i = 0; i < k; i++) {
            if (counts[i] > 0) {
                centroids[i] = {
                    lat: newCentroids[i].lat / counts[i],
                    lng: newCentroids[i].lng / counts[i]
                };
            }
            // If a cluster is empty, keep its previous centroid or re-initialize randomly
        }
    }

    // Group point IDs by cluster index
    const result: Record<number, string[]> = {};
    for (let i = 0; i < k; i++) result[i] = [];

    points.forEach((point, idx) => {
        const cIdx = assignments[idx];
        result[cIdx].push(point.id);
    });

    return result;
}

/**
 * Clusters activities into days based on geography.
 * Handles activities without coordinates by assigning them to clusters heuristically.
 */
export function clusterActivitiesIntoDays(
    activities: SuggestedActivity[],
    numDays: number
): Record<number, string[]> {
    const withCoords = activities.filter(a => a.coordinates) as (SuggestedActivity & { coordinates: Coordinates })[];
    const withoutCoords = activities.filter(a => !a.coordinates);

    const clusteredIds = kMeansClustering(
        withCoords.map(a => ({ id: a.id, coordinates: a.coordinates })),
        numDays
    );

    // Distribute activities without coordinates across clusters to keep day sizes balanced
    if (withoutCoords.length > 0) {
        // Sort clusters by number of activities (ascending) to balance distribution
        const clusterIndices = Object.keys(clusteredIds)
            .map(Number)
            .sort((a, b) => clusteredIds[a].length - clusteredIds[b].length);

        withoutCoords.forEach((activity, idx) => {
            const targetClusterIdx = clusterIndices[idx % clusterIndices.length];
            clusteredIds[targetClusterIdx].push(activity.id);
        });
    }

    return clusteredIds;
}
