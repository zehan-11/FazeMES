export interface SpaceSettings { nebula: number; fieldStars: number; clusterClouds: number }

export interface BloomSettings { strength: number; radius: number; threshold: number }
export interface PhysicsSettings { repel: number; linkDistance: number; linkStrength: number; centerPull: number; flatten: number; coreGravity: number; spiral: number }
export interface LookSettings { nodeSize: number; linkOpacity: number; linkCurve: number; twinkle: number; sizeBy: 'degree' | 'fileSize' | 'uniform' }
