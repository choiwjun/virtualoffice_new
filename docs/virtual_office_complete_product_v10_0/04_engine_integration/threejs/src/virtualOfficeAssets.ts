// Auto-generated Virtual Office Asset Manifest v7.0
export type AssetKind = '3d_glb' | 'scene_glb' | 'ui_asset';
export interface VirtualOfficeAsset { asset_id: string; category: string; type?: string; file: string; priority?: string; deliverable_kind: AssetKind; runtime_ready: boolean; }
export const VIRTUAL_OFFICE_ASSETS: VirtualOfficeAsset[] = [
  {
    "asset_id": "ARCH_FLOOR_CONCRETE_TILE_001",
    "category": "architecture",
    "type": "floor",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_FLOOR_CONCRETE_TILE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.0,
      "depth": 2.0,
      "height": 0.055
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 60,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.028
      ],
      "size": [
        2.0,
        2.0,
        0.055
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.055
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.036
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_FLOOR_WOOD_TILE_001",
    "category": "architecture",
    "type": "floor",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_FLOOR_WOOD_TILE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.0,
      "depth": 2.0,
      "height": 0.055
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 108,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.028
      ],
      "size": [
        2.0,
        2.0,
        0.055
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.055
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.036
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_FLOOR_CARPET_TILE_001",
    "category": "architecture",
    "type": "floor",
    "priority": "P2",
    "file": "01_runtime_3d/models/architecture/ARCH_FLOOR_CARPET_TILE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.0,
      "depth": 2.0,
      "height": 0.018
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 176,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.009
      ],
      "size": [
        2.0,
        2.0,
        0.018
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.018
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.012
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_WALL_SEGMENT_CONCRETE_001",
    "category": "architecture",
    "type": "wall",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_WALL_SEGMENT_CONCRETE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.0,
      "depth": 0.16,
      "height": 2.7
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 12,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.35
      ],
      "size": [
        2.0,
        0.16,
        2.7
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.755
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_WINDOW_TALL_001",
    "category": "architecture",
    "type": "window",
    "priority": "P2",
    "file": "01_runtime_3d/models/architecture/ARCH_WINDOW_TALL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.415,
      "depth": 0.07,
      "height": 1.34
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 72,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.67
      ],
      "size": [
        1.415,
        0.07,
        1.34
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.871
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_COLUMN_ROUND_001",
    "category": "architecture",
    "type": "column",
    "priority": "P2",
    "file": "01_runtime_3d/models/architecture/ARCH_COLUMN_ROUND_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.48,
      "depth": 0.48,
      "height": 2.7
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 192,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.35
      ],
      "size": [
        0.48,
        0.48,
        2.7
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.755
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_SIGNAGE_STANDING_001",
    "category": "architecture",
    "type": "signage",
    "priority": "P2",
    "file": "01_runtime_3d/models/architecture/ARCH_SIGNAGE_STANDING_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.75,
      "depth": 0.36,
      "height": 1.098
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 200,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.549
      ],
      "size": [
        0.75,
        0.36,
        1.098
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.098
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.714
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_GLASS_PARTITION_001",
    "category": "architecture",
    "type": "glass",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_GLASS_PARTITION_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.245,
      "depth": 0.05,
      "height": 2.255
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 60,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.127
      ],
      "size": [
        1.245,
        0.05,
        2.255
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.466
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_GLASS_DOOR_001",
    "category": "architecture",
    "type": "glass_door",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_GLASS_DOOR_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.1,
      "depth": 0.088,
      "height": 2.255
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 104,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.127
      ],
      "size": [
        1.1,
        0.088,
        2.255
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.466
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_GLASS_MEETING_ROOM_HERO_001",
    "category": "architecture",
    "type": "room_shell",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_GLASS_MEETING_ROOM_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.912,
      "depth": 2.837,
      "height": 2.322
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 292,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.161
      ],
      "size": [
        3.912,
        2.837,
        2.322
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.509
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "room_label_anchor": {
        "position": [
          0,
          -1.669,
          2.622
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_enter": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_NEON_ROOM_OUTLINE_BLUE_001",
    "category": "architecture",
    "type": "emissive",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_NEON_ROOM_OUTLINE_BLUE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.4,
      "depth": 0.04,
      "height": 0.04
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 12,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.02
      ],
      "size": [
        2.4,
        0.04,
        0.04
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.04
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.026
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ARCH_PLANTER_DIVIDER_001",
    "category": "architecture",
    "type": "planter",
    "priority": "P1",
    "file": "01_runtime_3d/models/architecture/ARCH_PLANTER_DIVIDER_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.62,
      "depth": 0.42,
      "height": 0.462
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 3932,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.231
      ],
      "size": [
        1.62,
        0.42,
        0.462
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.462
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.3
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RECEPTION_DESK_MARBLE_HERO_001",
    "category": "reception",
    "type": "reception_desk",
    "priority": "P1",
    "file": "01_runtime_3d/models/reception/RECEPTION_DESK_MARBLE_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.9,
      "depth": 0.935,
      "height": 1.128
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1148,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.564
      ],
      "size": [
        2.9,
        0.935,
        1.128
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.128
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.733
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.667,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -1.018,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RECEPTION_BACKWALL_WOOD_SLAT_HERO_001",
    "category": "reception",
    "type": "brand_wall",
    "priority": "P1",
    "file": "01_runtime_3d/models/reception/RECEPTION_BACKWALL_WOOD_SLAT_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 4.6,
      "depth": 0.22,
      "height": 2.6
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 314,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.3
      ],
      "size": [
        4.6,
        0.22,
        2.6
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.69
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RECEPTION_BRAND_WALL_001",
    "category": "reception",
    "type": "brand_wall",
    "priority": "P1",
    "file": "01_runtime_3d/models/reception/RECEPTION_BRAND_WALL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 4.6,
      "depth": 0.22,
      "height": 2.6
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 314,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.3
      ],
      "size": [
        4.6,
        0.22,
        2.6
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.69
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RECEPTION_COUNTER_LIGHT_STRIP_001",
    "category": "reception",
    "type": "light_strip",
    "priority": "P1",
    "file": "01_runtime_3d/models/reception/RECEPTION_COUNTER_LIGHT_STRIP_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.8,
      "depth": 0.05,
      "height": 0.05
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 12,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.025
      ],
      "size": [
        1.8,
        0.05,
        0.05
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.05
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.033
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RECEPTION_STAFF_CHAIR_001",
    "category": "reception",
    "type": "chair",
    "priority": "P2",
    "file": "01_runtime_3d/models/reception/RECEPTION_STAFF_CHAIR_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.868,
      "depth": 0.889,
      "height": 1.325
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 988,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.662
      ],
      "size": [
        0.868,
        0.889,
        1.325
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.861
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.675
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LOBBY_DECOR_SHELF_001",
    "category": "reception",
    "type": "shelf",
    "priority": "P1",
    "file": "01_runtime_3d/models/reception/LOBBY_DECOR_SHELF_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.4,
      "depth": 0.57,
      "height": 1.6
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 868,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.8
      ],
      "size": [
        1.4,
        0.57,
        1.6
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.04
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_STANDARD_001",
    "category": "workstation",
    "type": "desk",
    "priority": "P1",
    "file": "01_runtime_3d/models/workstation/DESK_STANDARD_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.65,
      "depth": 0.855,
      "height": 1.262
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 320,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.631
      ],
      "size": [
        1.65,
        0.855,
        1.262
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.82
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.627,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -0.978,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_L_CORNER_001",
    "category": "workstation",
    "type": "desk",
    "priority": "P2",
    "file": "01_runtime_3d/models/workstation/DESK_L_CORNER_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.815,
      "depth": 1.555,
      "height": 0.815
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 356,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.407
      ],
      "size": [
        1.815,
        1.555,
        0.815
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.815
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.53
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.978,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -1.328,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_BENCH_2P_001",
    "category": "workstation",
    "type": "desk",
    "priority": "P2",
    "file": "01_runtime_3d/models/workstation/DESK_BENCH_2P_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.45,
      "depth": 1.2,
      "height": 1.27
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 320,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.635
      ],
      "size": [
        2.45,
        1.2,
        1.27
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.826
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.8,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -1.15,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_BENCH_4P_HERO_001",
    "category": "workstation",
    "type": "desk_cluster",
    "priority": "P1",
    "file": "01_runtime_3d/models/workstation/DESK_BENCH_4P_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.4,
      "depth": 1.45,
      "height": 1.305
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1628,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.652
      ],
      "size": [
        3.4,
        1.45,
        1.305
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.848
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.925,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -1.275,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAIR_TASK_BLACK_HERO_001",
    "category": "workstation",
    "type": "chair",
    "priority": "P1",
    "file": "01_runtime_3d/models/workstation/CHAIR_TASK_BLACK_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.868,
      "depth": 0.889,
      "height": 1.325
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 976,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.662
      ],
      "size": [
        0.868,
        0.889,
        1.325
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.861
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.675
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAIR_EXECUTIVE_HIGHBACK_001",
    "category": "workstation",
    "type": "chair",
    "priority": "P2",
    "file": "01_runtime_3d/models/workstation/CHAIR_EXECUTIVE_HIGHBACK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.868,
      "depth": 0.889,
      "height": 1.325
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1120,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.662
      ],
      "size": [
        0.868,
        0.889,
        1.325
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.861
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.675
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAIR_GUEST_ARM_001",
    "category": "workstation",
    "type": "chair",
    "priority": "P2",
    "file": "01_runtime_3d/models/workstation/CHAIR_GUEST_ARM_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.55,
      "depth": 0.55,
      "height": 1.018
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 312,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.509
      ],
      "size": [
        0.55,
        0.55,
        1.018
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.018
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.662
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.368
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAIR_STOOL_BAR_001",
    "category": "workstation",
    "type": "chair",
    "priority": "P2",
    "file": "01_runtime_3d/models/workstation/CHAIR_STOOL_BAR_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.68,
      "depth": 0.68,
      "height": 0.8
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 368,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.4
      ],
      "size": [
        0.68,
        0.68,
        0.8
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.8
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.52
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.15
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_TABLE_8P_HERO_001",
    "category": "meeting",
    "type": "meeting_table",
    "priority": "P1",
    "file": "01_runtime_3d/models/meeting/MEETING_TABLE_8P_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.6,
      "depth": 1.15,
      "height": 0.64
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 276,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.32
      ],
      "size": [
        2.6,
        1.15,
        0.64
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.64
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.416
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "meeting_anchors": [
        {
          "id": "seat_01",
          "position": [
            -0.91,
            -0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_02",
          "position": [
            -0.303,
            -0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_03",
          "position": [
            0.303,
            -0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_04",
          "position": [
            0.91,
            -0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_05",
          "position": [
            -0.91,
            0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        },
        {
          "id": "seat_06",
          "position": [
            -0.303,
            0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        },
        {
          "id": "seat_07",
          "position": [
            0.303,
            0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        },
        {
          "id": "seat_08",
          "position": [
            0.91,
            0.995,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        }
      ]
    },
    "interaction": {
      "can_meet": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_TABLE_4P_001",
    "category": "meeting",
    "type": "meeting_table",
    "priority": "P2",
    "file": "01_runtime_3d/models/meeting/MEETING_TABLE_4P_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.6,
      "depth": 0.95,
      "height": 0.64
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 276,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.32
      ],
      "size": [
        1.6,
        0.95,
        0.64
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.64
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.416
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "meeting_anchors": [
        {
          "id": "seat_01",
          "position": [
            -0.56,
            -0.895,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_02",
          "position": [
            0.56,
            -0.895,
            0.48
          ],
          "rotation": [
            0,
            0,
            0
          ]
        },
        {
          "id": "seat_03",
          "position": [
            -0.56,
            0.895,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        },
        {
          "id": "seat_04",
          "position": [
            0.56,
            0.895,
            0.48
          ],
          "rotation": [
            0,
            0,
            180
          ]
        }
      ]
    },
    "interaction": {
      "can_meet": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_CHAIR_BLACK_001",
    "category": "meeting",
    "type": "chair",
    "priority": "P1",
    "file": "01_runtime_3d/models/meeting/MEETING_CHAIR_BLACK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.5,
      "depth": 0.486,
      "height": 1.086
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 232,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.543
      ],
      "size": [
        0.5,
        0.486,
        1.086
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.086
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.706
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.436
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_TV_WALL_001",
    "category": "meeting",
    "type": "display",
    "priority": "P1",
    "file": "01_runtime_3d/models/meeting/MEETING_TV_WALL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.65,
      "depth": 0.079,
      "height": 0.965
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 26,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.482
      ],
      "size": [
        1.65,
        0.079,
        0.965
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.965
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.627
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_WHITEBOARD_WALL_001",
    "category": "meeting",
    "type": "whiteboard",
    "priority": "P1",
    "file": "01_runtime_3d/models/meeting/MEETING_WHITEBOARD_WALL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.38,
      "depth": 0.053,
      "height": 1.165
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 184,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.583
      ],
      "size": [
        1.38,
        0.053,
        1.165
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.165
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.757
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_WHITEBOARD_MOBILE_001",
    "category": "meeting",
    "type": "whiteboard",
    "priority": "P2",
    "file": "01_runtime_3d/models/meeting/MEETING_WHITEBOARD_MOBILE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.38,
      "depth": 0.1,
      "height": 1.505
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 424,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.752
      ],
      "size": [
        1.38,
        0.1,
        1.505
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.978
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_CAMERA_BAR_001",
    "category": "meeting",
    "type": "camera",
    "priority": "P2",
    "file": "01_runtime_3d/models/meeting/MEETING_CAMERA_BAR_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.55,
      "depth": 0.09,
      "height": 0.083
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 236,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.042
      ],
      "size": [
        0.55,
        0.09,
        0.083
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.083
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.054
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MEETING_SPEAKERPHONE_001",
    "category": "meeting",
    "type": "speakerphone",
    "priority": "P2",
    "file": "01_runtime_3d/models/meeting/MEETING_SPEAKERPHONE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.28,
      "depth": 0.2,
      "height": 0.045
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 204,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.022
      ],
      "size": [
        0.28,
        0.2,
        0.045
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.045
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.029
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "SOFA_SECTIONAL_BLUE_HERO_001",
    "category": "lounge",
    "type": "sofa",
    "priority": "P1",
    "file": "01_runtime_3d/models/lounge/SOFA_SECTIONAL_BLUE_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.55,
      "depth": 1.645,
      "height": 1.09
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1440,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.545
      ],
      "size": [
        2.55,
        1.645,
        1.09
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.09
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.709
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "SOFA_3SEAT_LIGHT_001",
    "category": "lounge",
    "type": "sofa",
    "priority": "P1",
    "file": "01_runtime_3d/models/lounge/SOFA_3SEAT_LIGHT_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.55,
      "depth": 0.82,
      "height": 1.09
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1192,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.545
      ],
      "size": [
        2.55,
        0.82,
        1.09
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.09
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.709
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "SOFA_2SEAT_001",
    "category": "lounge",
    "type": "sofa",
    "priority": "P2",
    "file": "01_runtime_3d/models/lounge/SOFA_2SEAT_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.8,
      "depth": 0.82,
      "height": 1.09
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 992,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.545
      ],
      "size": [
        1.8,
        0.82,
        1.09
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.09
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.709
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LOUNGE_CHAIR_ROUND_001",
    "category": "lounge",
    "type": "chair",
    "priority": "P2",
    "file": "01_runtime_3d/models/lounge/LOUNGE_CHAIR_ROUND_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.05,
      "depth": 0.82,
      "height": 1.09
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 792,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.545
      ],
      "size": [
        1.05,
        0.82,
        1.09
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.09
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.709
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.44
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "TABLE_COFFEE_ROUND_001",
    "category": "lounge",
    "type": "table",
    "priority": "P1",
    "file": "01_runtime_3d/models/lounge/TABLE_COFFEE_ROUND_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.84,
      "depth": 0.84,
      "height": 0.455
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 336,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.228
      ],
      "size": [
        0.84,
        0.84,
        0.455
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.455
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.296
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "TABLE_SIDE_001",
    "category": "lounge",
    "type": "table",
    "priority": "P2",
    "file": "01_runtime_3d/models/lounge/TABLE_SIDE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.65,
      "depth": 0.45,
      "height": 0.49
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 300,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.245
      ],
      "size": [
        0.65,
        0.45,
        0.49
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.49
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.319
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "RUG_BLUE_PATTERN_001",
    "category": "lounge",
    "type": "rug",
    "priority": "P2",
    "file": "01_runtime_3d/models/lounge/RUG_BLUE_PATTERN_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.2,
      "depth": 1.45,
      "height": 0.018
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 176,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.009
      ],
      "size": [
        2.2,
        1.45,
        0.018
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.018
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.012
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PHONEBOOTH_1P_GLASS_001",
    "category": "focus",
    "type": "phonebooth",
    "priority": "P2",
    "file": "01_runtime_3d/models/focus/PHONEBOOTH_1P_GLASS_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.16,
      "depth": 1.177,
      "height": 3.3
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 296,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.65
      ],
      "size": [
        1.16,
        1.177,
        3.3
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          2.145
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "room_label_anchor": {
        "position": [
          0,
          -0.839,
          3.6
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_enter": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "FOCUS_POD_001",
    "category": "focus",
    "type": "focus_pod",
    "priority": "P2",
    "file": "01_runtime_3d/models/focus/FOCUS_POD_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.35,
      "depth": 1.055,
      "height": 1.66
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 368,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.83
      ],
      "size": [
        1.35,
        1.055,
        1.66
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.079
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "room_label_anchor": {
        "position": [
          0,
          -0.777,
          1.96
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_enter": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "ACOUSTIC_PANEL_001",
    "category": "focus",
    "type": "panel",
    "priority": "P2",
    "file": "01_runtime_3d/models/focus/ACOUSTIC_PANEL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.75,
      "depth": 0.069,
      "height": 1.413
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 156,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.707
      ],
      "size": [
        0.75,
        0.069,
        1.413
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.918
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PANTRY_COUNTER_MARBLE_HERO_001",
    "category": "pantry",
    "type": "counter",
    "priority": "P2",
    "file": "01_runtime_3d/models/pantry/PANTRY_COUNTER_MARBLE_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 2.95,
      "depth": 0.857,
      "height": 1.212
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 264,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.606
      ],
      "size": [
        2.95,
        0.857,
        1.212
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.788
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.629,
          0.75
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "chair_snap_anchor": {
        "position": [
          0,
          -0.979,
          0
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_work": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "WATER_DISPENSER_001",
    "category": "pantry",
    "type": "water_dispenser",
    "priority": "P1",
    "file": "01_runtime_3d/models/pantry/WATER_DISPENSER_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.38,
      "depth": 0.415,
      "height": 0.88
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 328,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.44
      ],
      "size": [
        0.38,
        0.415,
        0.88
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.88
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.572
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "COFFEE_MACHINE_001",
    "category": "pantry",
    "type": "coffee_machine",
    "priority": "P2",
    "file": "01_runtime_3d/models/pantry/COFFEE_MACHINE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.43,
      "depth": 0.395,
      "height": 0.745
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 268,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.372
      ],
      "size": [
        0.43,
        0.395,
        0.745
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.745
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.484
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "BAR_STOOL_BLUE_001",
    "category": "pantry",
    "type": "stool",
    "priority": "P2",
    "file": "01_runtime_3d/models/pantry/BAR_STOOL_BLUE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.68,
      "depth": 0.68,
      "height": 0.8
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 368,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.4
      ],
      "size": [
        0.68,
        0.68,
        0.8
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.8
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.52
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "seat_anchor": {
        "position": [
          0,
          0,
          0.48
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.15
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "can_sit": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "FRIDGE_001",
    "category": "pantry",
    "type": "fridge",
    "priority": "P2",
    "file": "01_runtime_3d/models/pantry/FRIDGE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.65,
      "depth": 0.609,
      "height": 2.075
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 128,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.038
      ],
      "size": [
        0.65,
        0.609,
        2.075
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.349
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MICROWAVE_001",
    "category": "pantry",
    "type": "microwave",
    "priority": "P2",
    "file": "01_runtime_3d/models/pantry/MICROWAVE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.58,
      "depth": 0.379,
      "height": 0.42
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 100,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.21
      ],
      "size": [
        0.58,
        0.379,
        0.42
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.42
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.273
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MONITOR_SINGLE_001",
    "category": "props",
    "type": "monitor",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/MONITOR_SINGLE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.48,
      "depth": 0.18,
      "height": 0.455
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 140,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.228
      ],
      "size": [
        0.48,
        0.18,
        0.455
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.455
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.296
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MONITOR_DUAL_001",
    "category": "props",
    "type": "monitor",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/MONITOR_DUAL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.12,
      "depth": 0.18,
      "height": 0.455
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 280,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.228
      ],
      "size": [
        1.12,
        0.18,
        0.455
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.455
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.296
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LAPTOP_OPEN_001",
    "category": "props",
    "type": "laptop",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/LAPTOP_OPEN_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.45,
      "depth": 0.393,
      "height": 0.312
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 112,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.156
      ],
      "size": [
        0.45,
        0.393,
        0.312
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.312
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.203
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "KEYBOARD_MOUSE_SET_001",
    "category": "props",
    "type": "keyboard_mouse",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/KEYBOARD_MOUSE_SET_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.643,
      "depth": 0.161,
      "height": 0.049
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 588,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.025
      ],
      "size": [
        0.643,
        0.161,
        0.049
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.049
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.032
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_LAMP_SLIM_001",
    "category": "props",
    "type": "lamp",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/DESK_LAMP_SLIM_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.522,
      "depth": 0.22,
      "height": 0.451
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 800,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.226
      ],
      "size": [
        0.522,
        0.22,
        0.451
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.451
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.293
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "MUG_CERAMIC_001",
    "category": "props",
    "type": "mug",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/MUG_CERAMIC_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.184,
      "depth": 0.12,
      "height": 0.103
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 272,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.051
      ],
      "size": [
        0.184,
        0.12,
        0.103
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.103
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.067
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "COFFEE_TAKEOUT_001",
    "category": "props",
    "type": "cup",
    "priority": "P1",
    "file": "01_runtime_3d/models/props/COFFEE_TAKEOUT_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.116,
      "depth": 0.12,
      "height": 0.162
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 204,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.081
      ],
      "size": [
        0.116,
        0.12,
        0.162
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.162
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.105
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DESK_PHONE_001",
    "category": "props",
    "type": "phone",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/DESK_PHONE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.22,
      "depth": 0.185,
      "height": 0.105
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 268,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.052
      ],
      "size": [
        0.22,
        0.185,
        0.105
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.105
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.068
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PAPER_STACK_001",
    "category": "props",
    "type": "paper",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/PAPER_STACK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.22,
      "depth": 0.3,
      "height": 0.041
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 72,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.021
      ],
      "size": [
        0.22,
        0.3,
        0.041
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.041
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.027
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PEN_HOLDER_001",
    "category": "props",
    "type": "pen_holder",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/PEN_HOLDER_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.106,
      "depth": 0.107,
      "height": 0.202
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 184,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.101
      ],
      "size": [
        0.106,
        0.107,
        0.202
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.202
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.131
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "BOOK_STACK_001",
    "category": "props",
    "type": "books",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/BOOK_STACK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.26,
      "depth": 0.18,
      "height": 0.149
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 48,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.074
      ],
      "size": [
        0.26,
        0.18,
        0.149
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.149
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.097
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "BINDER_SET_001",
    "category": "props",
    "type": "binder",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/BINDER_SET_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.315,
      "depth": 0.22,
      "height": 0.3
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 60,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.15
      ],
      "size": [
        0.315,
        0.22,
        0.3
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.3
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.195
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HEADSET_001",
    "category": "props",
    "type": "headset",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/HEADSET_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.31,
      "depth": 0.032,
      "height": 0.213
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 448,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.106
      ],
      "size": [
        0.31,
        0.032,
        0.213
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.213
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.138
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CABLE_SET_001",
    "category": "props",
    "type": "cable",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/CABLE_SET_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.532,
      "depth": 0.08,
      "height": 0.012
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 48,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.006
      ],
      "size": [
        0.532,
        0.08,
        0.012
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.012
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.008
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "DOCUMENT_TRAY_001",
    "category": "props",
    "type": "tray",
    "priority": "P2",
    "file": "01_runtime_3d/models/props/DOCUMENT_TRAY_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.35,
      "depth": 0.26,
      "height": 0.045
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 88,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.022
      ],
      "size": [
        0.35,
        0.26,
        0.045
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.045
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.029
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "SHELF_OPEN_001",
    "category": "storage",
    "type": "shelf",
    "priority": "P1",
    "file": "01_runtime_3d/models/storage/SHELF_OPEN_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.4,
      "depth": 0.57,
      "height": 1.6
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 868,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.8
      ],
      "size": [
        1.4,
        0.57,
        1.6
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.04
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CABINET_FILE_001",
    "category": "storage",
    "type": "cabinet",
    "priority": "P1",
    "file": "01_runtime_3d/models/storage/CABINET_FILE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.46,
      "depth": 0.575,
      "height": 0.97
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 148,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.485
      ],
      "size": [
        0.46,
        0.575,
        0.97
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.97
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.63
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LOCKER_001",
    "category": "storage",
    "type": "locker",
    "priority": "P2",
    "file": "01_runtime_3d/models/storage/LOCKER_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.91,
      "depth": 0.471,
      "height": 1.75
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 192,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.875
      ],
      "size": [
        0.91,
        0.471,
        1.75
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.137
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PRINTER_MFP_001",
    "category": "storage",
    "type": "printer",
    "priority": "P1",
    "file": "01_runtime_3d/models/storage/PRINTER_MFP_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.75,
      "depth": 0.598,
      "height": 0.43
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 188,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.215
      ],
      "size": [
        0.75,
        0.598,
        0.43
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.43
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.28
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "TRASH_BIN_001",
    "category": "storage",
    "type": "trash",
    "priority": "P2",
    "file": "01_runtime_3d/models/storage/TRASH_BIN_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.36,
      "depth": 0.36,
      "height": 0.335
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 192,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.168
      ],
      "size": [
        0.36,
        0.36,
        0.335
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.335
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.218
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PLANT_LARGE_REALISTIC_HERO_001",
    "category": "plants",
    "type": "plant",
    "priority": "P1",
    "file": "01_runtime_3d/models/plants/PLANT_LARGE_REALISTIC_HERO_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.852,
      "depth": 0.872,
      "height": 1.388
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 7792,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.694
      ],
      "size": [
        0.852,
        0.872,
        1.388
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.902
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PLANT_MEDIUM_001",
    "category": "plants",
    "type": "plant",
    "priority": "P1",
    "file": "01_runtime_3d/models/plants/PLANT_MEDIUM_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.556,
      "depth": 0.437,
      "height": 0.566
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 4296,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.283
      ],
      "size": [
        0.556,
        0.437,
        0.566
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.566
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.368
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PLANT_SMALL_DESK_001",
    "category": "plants",
    "type": "plant",
    "priority": "P1",
    "file": "01_runtime_3d/models/plants/PLANT_SMALL_DESK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.213,
      "depth": 0.171,
      "height": 0.221
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 632,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.111
      ],
      "size": [
        0.213,
        0.171,
        0.221
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.221
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.144
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "PLANT_HANGING_001",
    "category": "plants",
    "type": "plant",
    "priority": "P2",
    "file": "01_runtime_3d/models/plants/PLANT_HANGING_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.444,
      "depth": 0.4,
      "height": 1.04
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 1568,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.52
      ],
      "size": [
        0.444,
        0.4,
        1.04
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.04
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.676
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "WALL_ART_FRAME_001",
    "category": "decor",
    "type": "art",
    "priority": "P2",
    "file": "01_runtime_3d/models/decor/WALL_ART_FRAME_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.92,
      "depth": 0.05,
      "height": 0.62
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 14,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.31
      ],
      "size": [
        0.92,
        0.05,
        0.62
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.62
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.403
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "POSTER_FOCUS_PLAN_EXECUTE_001",
    "category": "decor",
    "type": "poster",
    "priority": "P2",
    "file": "01_runtime_3d/models/decor/POSTER_FOCUS_PLAN_EXECUTE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.6,
      "depth": 0.045,
      "height": 0.8
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 14,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.4
      ],
      "size": [
        0.6,
        0.045,
        0.8
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.8
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.52
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "WALL_CLOCK_001",
    "category": "decor",
    "type": "clock",
    "priority": "P2",
    "file": "01_runtime_3d/models/decor/WALL_CLOCK_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.45,
      "depth": 0.235,
      "height": 0.63
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 368,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.315
      ],
      "size": [
        0.45,
        0.235,
        0.63
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.63
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.41
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LIGHT_CEILING_PANEL_001",
    "category": "lighting",
    "type": "light",
    "priority": "P2",
    "file": "01_runtime_3d/models/lighting/LIGHT_CEILING_PANEL_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.0,
      "depth": 0.45,
      "height": 0.053
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 184,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.026
      ],
      "size": [
        1.0,
        0.45,
        0.053
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.053
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.034
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "LIGHT_PENDANT_WARM_001",
    "category": "lighting",
    "type": "light",
    "priority": "P2",
    "file": "01_runtime_3d/models/lighting/LIGHT_PENDANT_WARM_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.36,
      "depth": 0.36,
      "height": 0.813
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "",
    "qa": {
      "triangles": 664,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.406
      ],
      "size": [
        0.36,
        0.36,
        0.813
      ]
    },
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          0.813
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.528
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {},
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_MALE_001",
    "category": "characters",
    "type": "character",
    "priority": "P1",
    "file": "01_runtime_3d/models/characters/CHAR_MALE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.719,
      "depth": 0.292,
      "height": 1.722
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "unrigged T-pose mesh, Mixamo-ready",
    "qa": {
      "triangles": 1740,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.861
      ],
      "size": [
        1.719,
        0.292,
        1.722
      ]
    },
    "rig_status": "unrigged_t_pose_mixamo_ready",
    "required_animation_clips": [
      "idle",
      "walk",
      "sit",
      "typing",
      "wave",
      "talk"
    ],
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.119
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_dot_anchor": {
        "position": [
          0.25,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "avatar": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_FEMALE_001",
    "category": "characters",
    "type": "character",
    "priority": "P1",
    "file": "01_runtime_3d/models/characters/CHAR_FEMALE_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.719,
      "depth": 0.292,
      "height": 1.722
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "unrigged T-pose mesh, Mixamo-ready",
    "qa": {
      "triangles": 1740,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.861
      ],
      "size": [
        1.719,
        0.292,
        1.722
      ]
    },
    "rig_status": "unrigged_t_pose_mixamo_ready",
    "required_animation_clips": [
      "idle",
      "walk",
      "sit",
      "typing",
      "wave",
      "talk"
    ],
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.119
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_dot_anchor": {
        "position": [
          0.25,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "avatar": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_RECEPTIONIST_001",
    "category": "characters",
    "type": "character",
    "priority": "P1",
    "file": "01_runtime_3d/models/characters/CHAR_RECEPTIONIST_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.719,
      "depth": 0.308,
      "height": 1.722
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "unrigged T-pose mesh, Mixamo-ready",
    "qa": {
      "triangles": 1752,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.861
      ],
      "size": [
        1.719,
        0.308,
        1.722
      ]
    },
    "rig_status": "unrigged_t_pose_mixamo_ready",
    "required_animation_clips": [
      "idle",
      "walk",
      "sit",
      "typing",
      "wave",
      "talk"
    ],
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.119
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_dot_anchor": {
        "position": [
          0.25,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "avatar": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_MALE_CASUAL_002",
    "category": "characters",
    "type": "character",
    "priority": "P2",
    "file": "01_runtime_3d/models/characters/CHAR_MALE_CASUAL_002.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.719,
      "depth": 0.292,
      "height": 1.722
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "unrigged T-pose mesh, Mixamo-ready",
    "qa": {
      "triangles": 1740,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.861
      ],
      "size": [
        1.719,
        0.292,
        1.722
      ]
    },
    "rig_status": "unrigged_t_pose_mixamo_ready",
    "required_animation_clips": [
      "idle",
      "walk",
      "sit",
      "typing",
      "wave",
      "talk"
    ],
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.119
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_dot_anchor": {
        "position": [
          0.25,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "avatar": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_FEMALE_BUSINESS_002",
    "category": "characters",
    "type": "character",
    "priority": "P2",
    "file": "01_runtime_3d/models/characters/CHAR_FEMALE_BUSINESS_002.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 1.719,
      "depth": 0.292,
      "height": 1.722
    },
    "pbr_materials": true,
    "baked_lighting_in_basecolor": false,
    "notes": "unrigged T-pose mesh, Mixamo-ready",
    "qa": {
      "triangles": 1740,
      "source": "procedural_v3_hero_quality"
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.861
      ],
      "size": [
        1.719,
        0.292,
        1.722
      ]
    },
    "rig_status": "unrigged_t_pose_mixamo_ready",
    "required_animation_clips": [
      "idle",
      "walk",
      "sit",
      "typing",
      "wave",
      "talk"
    ],
    "anchors": {
      "interaction_anchor": {
        "position": [
          0,
          0,
          1.2
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.119
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_dot_anchor": {
        "position": [
          0.25,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "avatar": true
    },
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_FEMALE_HERO_V4_001",
    "name": "Char Female Hero V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "characters",
    "type": "avatar",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_characters/CHAR_FEMALE_HERO_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.55,
      "depth": 0.3,
      "height": 1.742
    },
    "triangle_count": 15552,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.871
      ],
      "size": [
        0.55,
        0.3,
        1.742
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.958
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          2.042
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true,
      "can_select": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 stylized high-detail static humanoid, rig-ready proportions; replace with skinned rig for production animation.",
    "thumbnail": "previews/v4/thumbnails/CHAR_FEMALE_HERO_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_MALE_HERO_V4_001",
    "name": "Char Male Hero V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "characters",
    "type": "avatar",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_characters/CHAR_MALE_HERO_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.55,
      "depth": 0.3,
      "height": 1.742
    },
    "triangle_count": 15552,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.871
      ],
      "size": [
        0.55,
        0.3,
        1.742
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.958
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          2.042
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true,
      "can_select": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 stylized high-detail static humanoid, rig-ready proportions; replace with skinned rig for production animation.",
    "thumbnail": "previews/v4/thumbnails/CHAR_MALE_HERO_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "CHAR_RECEPTIONIST_HERO_V4_001",
    "name": "Char Receptionist Hero V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "characters",
    "type": "avatar",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_characters/CHAR_RECEPTIONIST_HERO_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 0.59,
      "depth": 0.535,
      "height": 1.661
    },
    "triangle_count": 15552,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.831
      ],
      "size": [
        0.59,
        0.535,
        1.661
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.914
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.961
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "name_tag_anchor": {
        "position": [
          0,
          0,
          1.95
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true,
      "can_select": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 stylized high-detail static humanoid, rig-ready proportions; replace with skinned rig for production animation.",
    "thumbnail": "previews/v4/thumbnails/CHAR_RECEPTIONIST_HERO_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HERO_GLASS_MEETING_ROOM_V4_001",
    "name": "Hero Glass Meeting Room V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "hero",
    "type": "production_hero_module",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_hero/HERO_GLASS_MEETING_ROOM_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.7,
      "depth": 2.65,
      "height": 2.908
    },
    "triangle_count": 74032,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.454
      ],
      "size": [
        3.7,
        2.65,
        2.908
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.599
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          3.208
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "room_label_anchor": {
        "position": [
          0,
          0,
          3.258
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true,
      "can_enter_room": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 glass meeting room with transparent panels, metal frames, blue emissive outline, TV screen UI, table, chairs, people and plants.",
    "thumbnail": "previews/v4/thumbnails/HERO_GLASS_MEETING_ROOM_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HERO_LOUNGE_BLUE_AREA_V4_001",
    "name": "Hero Lounge Blue Area V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "hero",
    "type": "production_hero_module",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_hero/HERO_LOUNGE_BLUE_AREA_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.612,
      "depth": 2.238,
      "height": 1.013
    },
    "triangle_count": 74184,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.506
      ],
      "size": [
        3.612,
        2.238,
        1.013
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.557
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.313
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 lounge module with sectional sofa, rug, coffee table, pillows, lounge chair and plants.",
    "thumbnail": "previews/v4/thumbnails/HERO_LOUNGE_BLUE_AREA_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HERO_PANTRY_CAFE_V4_001",
    "name": "Hero Pantry Cafe V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "hero",
    "type": "production_hero_module",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_hero/HERO_PANTRY_CAFE_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.2,
      "depth": 1.715,
      "height": 2.122
    },
    "triangle_count": 8932,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.061
      ],
      "size": [
        3.2,
        1.715,
        2.122
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.167
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          2.422
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 pantry/cafe island with marble counter, bar stools, pendant lighting, coffee machine and accessories.",
    "thumbnail": "previews/v4/thumbnails/HERO_PANTRY_CAFE_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HERO_RECEPTION_LOBBY_V4_001",
    "name": "Hero Reception Lobby V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "hero",
    "type": "production_hero_module",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_hero/HERO_RECEPTION_LOBBY_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 4.5,
      "depth": 2.9,
      "height": 2.755
    },
    "triangle_count": 142470,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        1.378
      ],
      "size": [
        4.5,
        2.9,
        2.755
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          1.515
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          3.055
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 refined reception with individual wood slats, curved marble counter, emissive logo/signage and dense decor.",
    "thumbnail": "previews/v4/thumbnails/HERO_RECEPTION_LOBBY_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "HERO_WORKSTATION_CLUSTER_V4_001",
    "name": "Hero Workstation Cluster V4 001",
    "version": "4.0",
    "quality_tier": "v4_hero_refined_procedural",
    "category": "hero",
    "type": "production_hero_module",
    "priority": "P0",
    "file": "01_runtime_3d/models/v4_hero/HERO_WORKSTATION_CLUSTER_V4_001.glb",
    "format": "glb/glTF 2.0 binary",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "BOTTOM_CENTER",
    "floor_z": 0,
    "dimensions_m": {
      "width": 3.25,
      "depth": 2.969,
      "height": 1.659
    },
    "triangle_count": 139520,
    "materials": {
      "pbr": true,
      "v4_texture_sets": true,
      "basecolor_baked_lighting": false,
      "alpha_glass_or_emissive_when_required": true
    },
    "collision": {
      "type": "BOX",
      "center": [
        0,
        0,
        0.829
      ],
      "size": [
        3.25,
        2.969,
        1.659
      ]
    },
    "anchors": {
      "camera_focus_anchor": {
        "position": [
          0,
          0,
          0.912
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "status_anchor": {
        "position": [
          0,
          0,
          1.959
        ],
        "rotation": [
          0,
          0,
          0
        ]
      },
      "work_anchor": {
        "position": [
          0,
          -0.45,
          0.78
        ],
        "rotation": [
          0,
          0,
          0
        ]
      }
    },
    "interaction": {
      "module": true,
      "can_work": true
    },
    "tags": [
      "v4",
      "hero",
      "high_detail",
      "reference_aligned",
      "procedural_mesh"
    ],
    "notes": "V4 workstation cluster with 4 seats, divider planter, monitors, keyboards, cables, seated avatars and desk props.",
    "thumbnail": "previews/v4/thumbnails/HERO_WORKSTATION_CLUSTER_V4_001.png",
    "runtime_ready": true,
    "deliverable_kind": "3d_glb"
  },
  {
    "asset_id": "SCENE_ACME_HQ_HERO_V3_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_ACME_HQ_HERO_V3_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "SCENE_ACME_HQ_HERO_V4_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_ACME_HQ_HERO_V4_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "SCENE_ASSET_GALLERY_HERO_V3_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_ASSET_GALLERY_HERO_V3_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "SCENE_ASSET_GALLERY_HERO_V4_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_ASSET_GALLERY_HERO_V4_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "SCENE_VERTICAL_SLICE_HERO_V3_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_VERTICAL_SLICE_HERO_V3_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "SCENE_VERTICAL_SLICE_HERO_V4_001",
    "category": "scene",
    "type": "composite_scene",
    "priority": "P0",
    "file": "01_runtime_3d/scenes/SCENE_VERTICAL_SLICE_HERO_V4_001.glb",
    "unit": "meter",
    "up_axis": "Z",
    "pivot": "SCENE_ORIGIN",
    "floor_z": 0,
    "deliverable_kind": "scene_glb",
    "runtime_ready": true,
    "notes": "Composite scene for direct engine import."
  },
  {
    "asset_id": "UI_LEFT_SIDEBAR",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_LEFT_SIDEBAR.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_MINIMAP_FLOOR_1",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_MINIMAP_FLOOR_1.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_NAME_TAG_ONLINE",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_NAME_TAG_ONLINE.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_PEOPLE_PANEL",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_PEOPLE_PANEL.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_ROOM_LABEL_PRODUCT_SYNC",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_ROOM_LABEL_PRODUCT_SYNC.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_VIDEO_MEETING_CARD",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_VIDEO_MEETING_CARD.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_WALK_HINT_ENTER",
    "category": "ui_overlay",
    "type": "png",
    "priority": "P0",
    "file": "02_ui_overlay_assets/png/UI_WALK_HINT_ENTER.png",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_ROOM_OUTLINE_BLUE",
    "category": "ui_overlay",
    "type": "svg",
    "priority": "P0",
    "file": "02_ui_overlay_assets/svg/UI_ROOM_OUTLINE_BLUE.svg",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_SEARCH_BOX",
    "category": "ui_overlay",
    "type": "svg",
    "priority": "P0",
    "file": "02_ui_overlay_assets/svg/UI_SEARCH_BOX.svg",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_STATUS_DOT_ONLINE",
    "category": "ui_overlay",
    "type": "svg",
    "priority": "P0",
    "file": "02_ui_overlay_assets/svg/UI_STATUS_DOT_ONLINE.svg",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  },
  {
    "asset_id": "UI_VIDEO_ICON",
    "category": "ui_overlay",
    "type": "svg",
    "priority": "P0",
    "file": "02_ui_overlay_assets/svg/UI_VIDEO_ICON.svg",
    "deliverable_kind": "ui_asset",
    "runtime_ready": true,
    "notes": "UI overlay matching the supplied virtual-office concept."
  }
];

export const byId = Object.fromEntries(VIRTUAL_OFFICE_ASSETS.map(a => [a.asset_id, a]));
export const sceneHero = byId['SCENE_ACME_HQ_HERO_V4_001'];
