import { kMeansClustering } from '../lib/utils/clustering';

const points = [
  // Cluster 1 (West London)
  { id: 'Notting Hill', coordinates: { lat: 51.509, lng: -0.209 } },
  { id: 'Kensington Garden', coordinates: { lat: 51.507, lng: -0.179 } },
  { id: 'Science Museum', coordinates: { lat: 51.497, lng: -0.174 } },
  
  // Cluster 2 (East London)
  { id: 'Tower of London', coordinates: { lat: 51.508, lng: -0.076 } },
  { id: 'Tower Bridge', coordinates: { lat: 51.505, lng: -0.075 } },
  { id: 'Sky Garden', coordinates: { lat: 51.511, lng: -0.083 } },

  // Cluster 3 (Central/South)
  { id: 'Big Ben', coordinates: { lat: 51.500, lng: -0.124 } },
  { id: 'London Eye', coordinates: { lat: 51.503, lng: -0.119 } },
  { id: 'Westminster Abbey', coordinates: { lat: 51.499, lng: -0.127 } }
];

const result = kMeansClustering(points, 3);
console.log('Clustering results for London:');
Object.entries(result).forEach(([clusterIdx, ids]) => {
  console.log(`Cluster ${parseInt(clusterIdx) + 1}:`, ids.join(', '));
});

