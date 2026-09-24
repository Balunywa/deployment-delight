export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Row types for the control-plane schema in db/migrations.
export type Database = {
  public: {
    Tables: {
      approvals: {
        Row: {
          approval_type: string;
          comments: string | null;
          decided_at: string | null;
          decided_by: string | null;
          deployment_id: string;
          id: string;
          requested_at: string;
          requested_from: string | null;
          status: Database["public"]["Enums"]["approval_status"];
        };
        Insert: {
          approval_type: string;
          comments?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          deployment_id: string;
          id?: string;
          requested_at?: string;
          requested_from?: string | null;
          status?: Database["public"]["Enums"]["approval_status"];
        };
        Update: {
          approval_type?: string;
          comments?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          deployment_id?: string;
          id?: string;
          requested_at?: string;
          requested_from?: string | null;
          status?: Database["public"]["Enums"]["approval_status"];
        };
        Relationships: [
          {
            foreignKeyName: "approvals_deployment_id_fkey";
            columns: ["deployment_id"];
            isOneToOne: false;
            referencedRelation: "deployments";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          actor_id: string | null;
          actor_name: string | null;
          correlation_id: string | null;
          customer_id: string | null;
          environment_id: string | null;
          event_type: string;
          id: string;
          metadata_json: Json;
          new_value: Json | null;
          organization_id: string;
          previous_value: Json | null;
          resource_id: string | null;
          resource_type: string | null;
          result: string | null;
          timestamp: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_name?: string | null;
          correlation_id?: string | null;
          customer_id?: string | null;
          environment_id?: string | null;
          event_type: string;
          id?: string;
          metadata_json?: Json;
          new_value?: Json | null;
          organization_id: string;
          previous_value?: Json | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result?: string | null;
          timestamp?: string;
        };
        Update: {
          actor_id?: string | null;
          actor_name?: string | null;
          correlation_id?: string | null;
          customer_id?: string | null;
          environment_id?: string | null;
          event_type?: string;
          id?: string;
          metadata_json?: Json;
          new_value?: Json | null;
          organization_id?: string;
          previous_value?: Json | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result?: string | null;
          timestamp?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_events_environment_id_fkey";
            columns: ["environment_id"];
            isOneToOne: false;
            referencedRelation: "environments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_checks: {
        Row: {
          control_key: string;
          control_name: string;
          environment_id: string;
          evaluated_at: string;
          evidence_json: Json;
          id: string;
          policy_pack_id: string | null;
          result: string;
        };
        Insert: {
          control_key: string;
          control_name: string;
          environment_id: string;
          evaluated_at?: string;
          evidence_json?: Json;
          id?: string;
          policy_pack_id?: string | null;
          result?: string;
        };
        Update: {
          control_key?: string;
          control_name?: string;
          environment_id?: string;
          evaluated_at?: string;
          evidence_json?: Json;
          id?: string;
          policy_pack_id?: string | null;
          result?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_checks_environment_id_fkey";
            columns: ["environment_id"];
            isOneToOne: false;
            referencedRelation: "environments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compliance_checks_policy_pack_id_fkey";
            columns: ["policy_pack_id"];
            isOneToOne: false;
            referencedRelation: "policy_packs";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_connections: {
        Row: {
          connection_type: Database["public"]["Enums"]["connection_type"];
          created_at: string;
          credential_reference: string | null;
          customer_id: string;
          id: string;
          last_validated_at: string | null;
          lighthouse_delegation_id: string | null;
          management_group_id: string | null;
          metadata_json: Json;
          resource_group_id: string | null;
          status: string;
          subscription_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          connection_type: Database["public"]["Enums"]["connection_type"];
          created_at?: string;
          credential_reference?: string | null;
          customer_id: string;
          id?: string;
          last_validated_at?: string | null;
          lighthouse_delegation_id?: string | null;
          management_group_id?: string | null;
          metadata_json?: Json;
          resource_group_id?: string | null;
          status?: string;
          subscription_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          connection_type?: Database["public"]["Enums"]["connection_type"];
          created_at?: string;
          credential_reference?: string | null;
          customer_id?: string;
          id?: string;
          last_validated_at?: string | null;
          lighthouse_delegation_id?: string | null;
          management_group_id?: string | null;
          metadata_json?: Json;
          resource_group_id?: string | null;
          status?: string;
          subscription_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_connections_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          azure_model: string;
          created_at: string;
          customer_code: string;
          id: string;
          industry: string | null;
          name: string;
          organization_id: string;
          status: string;
          tenant_id: string | null;
        };
        Insert: {
          azure_model?: string;
          created_at?: string;
          customer_code: string;
          id?: string;
          industry?: string | null;
          name: string;
          organization_id: string;
          status?: string;
          tenant_id?: string | null;
        };
        Update: {
          azure_model?: string;
          created_at?: string;
          customer_code?: string;
          id?: string;
          industry?: string | null;
          name?: string;
          organization_id?: string;
          status?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      deployment_steps: {
        Row: {
          completed_at: string | null;
          deployment_id: string;
          error_json: Json | null;
          id: string;
          log_text: string | null;
          module_name: string | null;
          name: string;
          sequence: number;
          started_at: string | null;
          status: Database["public"]["Enums"]["step_status"];
        };
        Insert: {
          completed_at?: string | null;
          deployment_id: string;
          error_json?: Json | null;
          id?: string;
          log_text?: string | null;
          module_name?: string | null;
          name: string;
          sequence: number;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["step_status"];
        };
        Update: {
          completed_at?: string | null;
          deployment_id?: string;
          error_json?: Json | null;
          id?: string;
          log_text?: string | null;
          module_name?: string | null;
          name?: string;
          sequence?: number;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["step_status"];
        };
        Relationships: [
          {
            foreignKeyName: "deployment_steps_deployment_id_fkey";
            columns: ["deployment_id"];
            isOneToOne: false;
            referencedRelation: "deployments";
            referencedColumns: ["id"];
          },
        ];
      };
      deployments: {
        Row: {
          completed_at: string | null;
          correlation_id: string;
          deployment_type: Database["public"]["Enums"]["deployment_type"];
          desired_version: string | null;
          environment_id: string;
          id: string;
          mode: string;
          plan_json: Json;
          preflight_json: Json;
          previous_version: string | null;
          requested_at: string;
          requested_by: string | null;
          result_json: Json;
          started_at: string | null;
          status: Database["public"]["Enums"]["deployment_status"];
        };
        Insert: {
          completed_at?: string | null;
          correlation_id?: string;
          deployment_type?: Database["public"]["Enums"]["deployment_type"];
          desired_version?: string | null;
          environment_id: string;
          id?: string;
          mode?: string;
          plan_json?: Json;
          preflight_json?: Json;
          previous_version?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          result_json?: Json;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["deployment_status"];
        };
        Update: {
          completed_at?: string | null;
          correlation_id?: string;
          deployment_type?: Database["public"]["Enums"]["deployment_type"];
          desired_version?: string | null;
          environment_id?: string;
          id?: string;
          mode?: string;
          plan_json?: Json;
          preflight_json?: Json;
          previous_version?: string | null;
          requested_at?: string;
          requested_by?: string | null;
          result_json?: Json;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["deployment_status"];
        };
        Relationships: [
          {
            foreignKeyName: "deployments_environment_id_fkey";
            columns: ["environment_id"];
            isOneToOne: false;
            referencedRelation: "environments";
            referencedColumns: ["id"];
          },
        ];
      };
      drift_findings: {
        Row: {
          actual_json: Json;
          category: string;
          detected_at: string;
          environment_id: string;
          expected_json: Json;
          id: string;
          recommended_remediation: string | null;
          resolved_at: string | null;
          resource_id: string;
          severity: Database["public"]["Enums"]["severity"];
          status: string;
        };
        Insert: {
          actual_json?: Json;
          category: string;
          detected_at?: string;
          environment_id: string;
          expected_json?: Json;
          id?: string;
          recommended_remediation?: string | null;
          resolved_at?: string | null;
          resource_id: string;
          severity?: Database["public"]["Enums"]["severity"];
          status?: string;
        };
        Update: {
          actual_json?: Json;
          category?: string;
          detected_at?: string;
          environment_id?: string;
          expected_json?: Json;
          id?: string;
          recommended_remediation?: string | null;
          resolved_at?: string | null;
          resource_id?: string;
          severity?: Database["public"]["Enums"]["severity"];
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drift_findings_environment_id_fkey";
            columns: ["environment_id"];
            isOneToOne: false;
            referencedRelation: "environments";
            referencedColumns: ["id"];
          },
        ];
      };
      foundations: {
        Row: {
          answers: Json;
          created_at: string;
          customer_id: string | null;
          deployed_ref: string | null;
          discovered: Json;
          id: string;
          last_deployed_at: string | null;
          library_ref: string;
          mode: string;
          name: string;
          organization_id: string;
          status: string;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          answers?: Json;
          customer_id?: string | null;
          deployed_ref?: string | null;
          discovered?: Json;
          id?: string;
          last_deployed_at?: string | null;
          library_ref: string;
          mode?: string;
          name: string;
          organization_id: string;
          status?: string;
          tenant_id?: string | null;
        };
        Update: {
          answers?: Json;
          deployed_ref?: string | null;
          library_ref?: string;
          status?: string;
          last_deployed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      environments: {
        Row: {
          actual_offering_version_id: string | null;
          compliance_score: number;
          configuration_json: Json;
          created_at: string;
          customer_id: string;
          deployment_boundary: string;
          desired_offering_version_id: string | null;
          environment_type: Database["public"]["Enums"]["environment_type"];
          id: string;
          monthly_cost_estimate: number | null;
          name: string;
          offering_id: string;
          region: string;
          secondary_region: string | null;
          status: string;
        };
        Insert: {
          actual_offering_version_id?: string | null;
          compliance_score?: number;
          configuration_json?: Json;
          created_at?: string;
          customer_id: string;
          deployment_boundary?: string;
          desired_offering_version_id?: string | null;
          environment_type: Database["public"]["Enums"]["environment_type"];
          id?: string;
          monthly_cost_estimate?: number | null;
          name: string;
          offering_id: string;
          region: string;
          secondary_region?: string | null;
          status?: string;
        };
        Update: {
          actual_offering_version_id?: string | null;
          compliance_score?: number;
          configuration_json?: Json;
          created_at?: string;
          customer_id?: string;
          deployment_boundary?: string;
          desired_offering_version_id?: string | null;
          environment_type?: Database["public"]["Enums"]["environment_type"];
          id?: string;
          monthly_cost_estimate?: number | null;
          name?: string;
          offering_id?: string;
          region?: string;
          secondary_region?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "environments_actual_offering_version_id_fkey";
            columns: ["actual_offering_version_id"];
            isOneToOne: false;
            referencedRelation: "offering_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "environments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "environments_desired_offering_version_id_fkey";
            columns: ["desired_offering_version_id"];
            isOneToOne: false;
            referencedRelation: "offering_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "environments_offering_id_fkey";
            columns: ["offering_id"];
            isOneToOne: false;
            referencedRelation: "offerings";
            referencedColumns: ["id"];
          },
        ];
      };
      infrastructure_modules: {
        Row: {
          created_at: string;
          id: string;
          input_schema_json: Json;
          module_type: string;
          name: string;
          organization_id: string;
          output_schema_json: Json;
          provider: string;
          source: string | null;
          version: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          input_schema_json?: Json;
          module_type: string;
          name: string;
          organization_id: string;
          output_schema_json?: Json;
          provider?: string;
          source?: string | null;
          version: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          input_schema_json?: Json;
          module_type?: string;
          name?: string;
          organization_id?: string;
          output_schema_json?: Json;
          provider?: string;
          source?: string | null;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "infrastructure_modules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      offering_versions: {
        Row: {
          ai_generated: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          manifest_json: Json;
          offering_id: string;
          published_at: string | null;
          release_notes: string | null;
          status: Database["public"]["Enums"]["version_status"];
          version: string;
        };
        Insert: {
          ai_generated?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          manifest_json?: Json;
          offering_id: string;
          published_at?: string | null;
          release_notes?: string | null;
          status?: Database["public"]["Enums"]["version_status"];
          version: string;
        };
        Update: {
          ai_generated?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          manifest_json?: Json;
          offering_id?: string;
          published_at?: string | null;
          release_notes?: string | null;
          status?: Database["public"]["Enums"]["version_status"];
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "offering_versions_offering_id_fkey";
            columns: ["offering_id"];
            isOneToOne: false;
            referencedRelation: "offerings";
            referencedColumns: ["id"];
          },
        ];
      };
      offerings: {
        Row: {
          created_at: string;
          deployment_boundary: string;
          description: string | null;
          estimated_monthly_cost_high: number | null;
          estimated_monthly_cost_low: number | null;
          id: string;
          name: string;
          network_profile: string | null;
          offering_type: Database["public"]["Enums"]["offering_type"];
          product_id: string;
          security_profile: string | null;
          status: string;
          supported_regions: string[];
        };
        Insert: {
          created_at?: string;
          deployment_boundary?: string;
          description?: string | null;
          estimated_monthly_cost_high?: number | null;
          estimated_monthly_cost_low?: number | null;
          id?: string;
          name: string;
          network_profile?: string | null;
          offering_type: Database["public"]["Enums"]["offering_type"];
          product_id: string;
          security_profile?: string | null;
          status?: string;
          supported_regions?: string[];
        };
        Update: {
          created_at?: string;
          deployment_boundary?: string;
          description?: string | null;
          estimated_monthly_cost_high?: number | null;
          estimated_monthly_cost_low?: number | null;
          id?: string;
          name?: string;
          network_profile?: string | null;
          offering_type?: Database["public"]["Enums"]["offering_type"];
          product_id?: string;
          security_profile?: string | null;
          status?: string;
          supported_regions?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "offerings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: string;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          demo_mode: boolean;
          id: string;
          logo_url: string | null;
          name: string;
          portal_title: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          slug: string;
          support_url: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          demo_mode?: boolean;
          id?: string;
          logo_url?: string | null;
          name: string;
          portal_title?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          slug: string;
          support_url?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          demo_mode?: boolean;
          id?: string;
          logo_url?: string | null;
          name?: string;
          portal_title?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          slug?: string;
          support_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      policy_packs: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          policy_manifest_json: Json;
          version: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          policy_manifest_json?: Json;
          version: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          policy_manifest_json?: Json;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policy_packs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          category: string | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          status: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          status?: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      upgrade_waves: {
        Row: {
          created_at: string;
          environment_ids: string[];
          id: string;
          name: string;
          offering_version_id: string | null;
          organization_id: string;
          sequence: number;
          status: string;
        };
        Insert: {
          created_at?: string;
          environment_ids?: string[];
          id?: string;
          name: string;
          offering_version_id?: string | null;
          organization_id: string;
          sequence?: number;
          status?: string;
        };
        Update: {
          created_at?: string;
          environment_ids?: string[];
          id?: string;
          name?: string;
          offering_version_id?: string | null;
          organization_id?: string;
          sequence?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upgrade_waves_offering_version_id_fkey";
            columns: ["offering_version_id"];
            isOneToOne: false;
            referencedRelation: "offering_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "upgrade_waves_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      approval_status: "pending" | "approved" | "rejected" | "expired";
      connection_type:
        | "existing_subscription"
        | "new_subscription"
        | "existing_resource_group"
        | "lighthouse"
        | "managed_application"
        | "federated_identity";
      deployment_status:
        | "DRAFT"
        | "VALIDATING"
        | "VALIDATION_FAILED"
        | "READY"
        | "AWAITING_APPROVAL"
        | "PLANNING"
        | "PLAN_FAILED"
        | "AWAITING_PLAN_APPROVAL"
        | "QUEUED"
        | "DEPLOYING"
        | "SUCCEEDED"
        | "FAILED"
        | "REQUIRES_REMEDIATION"
        | "CANCELLED";
      deployment_type:
        | "initial"
        | "upgrade"
        | "configuration_change"
        | "repair"
        | "drift_remediation"
        | "decommission";
      environment_type:
        "development" | "test" | "qa" | "uat" | "staging" | "production" | "disaster_recovery";
      offering_type:
        | "saas_connected"
        | "customer_hosted"
        | "enterprise_private"
        | "regulated"
        | "edge"
        | "sandbox";
      severity: "low" | "medium" | "high" | "critical";
      step_status: "pending" | "running" | "succeeded" | "failed" | "skipped";
      version_status: "draft" | "testing" | "published" | "deprecated" | "retired";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Database;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      approval_status: ["pending", "approved", "rejected", "expired"],
      connection_type: [
        "existing_subscription",
        "new_subscription",
        "existing_resource_group",
        "lighthouse",
        "managed_application",
        "federated_identity",
      ],
      deployment_status: [
        "DRAFT",
        "VALIDATING",
        "VALIDATION_FAILED",
        "READY",
        "AWAITING_APPROVAL",
        "PLANNING",
        "PLAN_FAILED",
        "AWAITING_PLAN_APPROVAL",
        "QUEUED",
        "DEPLOYING",
        "SUCCEEDED",
        "FAILED",
        "REQUIRES_REMEDIATION",
        "CANCELLED",
      ],
      deployment_type: [
        "initial",
        "upgrade",
        "configuration_change",
        "repair",
        "drift_remediation",
        "decommission",
      ],
      environment_type: [
        "development",
        "test",
        "qa",
        "uat",
        "staging",
        "production",
        "disaster_recovery",
      ],
      offering_type: [
        "saas_connected",
        "customer_hosted",
        "enterprise_private",
        "regulated",
        "edge",
        "sandbox",
      ],
      severity: ["low", "medium", "high", "critical"],
      step_status: ["pending", "running", "succeeded", "failed", "skipped"],
      version_status: ["draft", "testing", "published", "deprecated", "retired"],
    },
  },
} as const;
