export type Vec3 = [number, number, number];

export interface AnchorData {
  position: Vec3;
  rotation?: Vec3;
}

export interface AssetRecord {
  asset_id: string;
  category: string;
  type?: string;
  priority?: string;
  file: string;
  legacy_file?: string;
  dimensions_m?: { width?: number; depth?: number; height?: number };
  collision?: { type?: string; center?: Vec3; size?: Vec3 };
  anchors?: Record<string, AnchorData>;
  interaction?: Record<string, unknown>;
  runtime_ready?: boolean;
  deliverable_kind?: string;
}

export interface AssetRegistry {
  version: string;
  asset_count: number;
  assets: AssetRecord[];
}

export interface LayoutInstance {
  instance_id: string;
  asset_id: string;
  position: Vec3;
  rotation_z_deg: number;
  scale?: Vec3;
}

export interface LayoutPreset {
  version: string;
  preset_id: string;
  name: string;
  bounds_xy: [number, number, number, number];
  avatar_spawn: Vec3;
  instances: LayoutInstance[];
}

export type ClipId =
  | 'ANIM_IDLE_001' | 'ANIM_WALK_001' | 'ANIM_SIT_001'
  | 'ANIM_SIT_DOWN_001' | 'ANIM_STAND_UP_001' | 'ANIM_TYPING_001'
  | 'ANIM_TALK_001' | 'ANIM_WAVE_001' | 'ANIM_MEETING_IDLE_001'
  | 'ANIM_POINT_001' | 'ANIM_PHONE_CALL_001' | 'ANIM_CLAP_001';
