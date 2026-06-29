export type RoonOutput = {
  output_id: string;
  zone_id?: string;
  display_name: string;
  can_group_with_output_ids?: string[];
  volume?: {
    type?: string;
    min?: number;
    max?: number;
    value?: number;
    step?: number;
    is_muted?: boolean;
  };
  [key: string]: unknown;
};

export type RoonZone = {
  zone_id: string;
  display_name: string;
  state: string;
  now_playing?: {
    three_line?: {
      line1?: string;
      line2?: string;
      line3?: string;
    };
  };
  outputs?: RoonOutput[];
  is_play_allowed?: boolean;
  is_pause_allowed?: boolean;
  is_next_allowed?: boolean;
  is_previous_allowed?: boolean;
  [key: string]: unknown;
};

export type PublicZone = {
  zone_id: string;
  display_name: string;
  state: string;
  now_playing: {
    line1: string | null;
    line2: string | null;
    line3: string | null;
  };
  outputs: RoonOutput[];
};
