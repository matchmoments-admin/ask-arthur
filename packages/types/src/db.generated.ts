export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      acnc_charities: {
        Row: {
          abn: string
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          beneficiaries: string[]
          charity_legal_name: string
          charity_size: string | null
          charity_website: string | null
          country: string | null
          date_established: string | null
          delisted_at: string | null
          financial_year_end: string | null
          ingested_at: string
          is_delisted: boolean
          is_hpc: boolean
          is_pbi: boolean
          last_seen_in_register: string | null
          number_responsible_persons: number | null
          operates_in_states: string[]
          operating_countries: string | null
          other_names: string[]
          postcode: string | null
          purposes: string[]
          registration_date: string | null
          source_resource_id: string
          source_row_hash: string
          state: string | null
          town_city: string | null
          updated_at: string
        }
        Insert: {
          abn: string
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          beneficiaries?: string[]
          charity_legal_name: string
          charity_size?: string | null
          charity_website?: string | null
          country?: string | null
          date_established?: string | null
          delisted_at?: string | null
          financial_year_end?: string | null
          ingested_at?: string
          is_delisted?: boolean
          is_hpc?: boolean
          is_pbi?: boolean
          last_seen_in_register?: string | null
          number_responsible_persons?: number | null
          operates_in_states?: string[]
          operating_countries?: string | null
          other_names?: string[]
          postcode?: string | null
          purposes?: string[]
          registration_date?: string | null
          source_resource_id: string
          source_row_hash: string
          state?: string | null
          town_city?: string | null
          updated_at?: string
        }
        Update: {
          abn?: string
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          beneficiaries?: string[]
          charity_legal_name?: string
          charity_size?: string | null
          charity_website?: string | null
          country?: string | null
          date_established?: string | null
          delisted_at?: string | null
          financial_year_end?: string | null
          ingested_at?: string
          is_delisted?: boolean
          is_hpc?: boolean
          is_pbi?: boolean
          last_seen_in_register?: string | null
          number_responsible_persons?: number | null
          operates_in_states?: string[]
          operating_countries?: string | null
          other_names?: string[]
          postcode?: string | null
          purposes?: string[]
          registration_date?: string | null
          source_resource_id?: string
          source_row_hash?: string
          state?: string | null
          town_city?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      acnc_charity_embeddings: {
        Row: {
          charity_abn: string
          embedded_at: string
          embedding: string
          model: string
        }
        Insert: {
          charity_abn: string
          embedded_at?: string
          embedding: string
          model: string
        }
        Update: {
          charity_abn?: string
          embedded_at?: string
          embedding?: string
          model?: string
        }
        Relationships: [
          {
            foreignKeyName: "acnc_charity_embeddings_charity_abn_fkey"
            columns: ["charity_abn"]
            isOneToOne: true
            referencedRelation: "acnc_charities"
            referencedColumns: ["abn"]
          },
        ]
      }
      analytics_events: {
        Row: {
          anonymous_id: string
          created_at: string
          event_props: Json
          event_type: string
          id: string
          path: string | null
          referrer: string | null
          request_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          anonymous_id: string
          created_at?: string
          event_props?: Json
          event_type: string
          id?: string
          path?: string | null
          referrer?: string | null
          request_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          anonymous_id?: string
          created_at?: string
          event_props?: Json
          event_type?: string
          id?: string
          path?: string | null
          referrer?: string | null
          request_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_anonymous_id_fkey"
            columns: ["anonymous_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["anonymous_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          allowed_endpoints: string[]
          billing_email: string | null
          created_at: string
          daily_limit: number
          id: number
          is_active: boolean
          key_hash: string
          last_used_at: string | null
          max_batch_size: number
          org_id: string | null
          org_name: string
          rate_limit_per_minute: number
          tier: string
          user_id: string | null
        }
        Insert: {
          allowed_endpoints?: string[]
          billing_email?: string | null
          created_at?: string
          daily_limit?: number
          id?: never
          is_active?: boolean
          key_hash: string
          last_used_at?: string | null
          max_batch_size?: number
          org_id?: string | null
          org_name: string
          rate_limit_per_minute?: number
          tier?: string
          user_id?: string | null
        }
        Update: {
          allowed_endpoints?: string[]
          billing_email?: string | null
          created_at?: string
          daily_limit?: number
          id?: never
          is_active?: boolean
          key_hash?: string
          last_used_at?: string | null
          max_batch_size?: number
          org_id?: string | null
          org_name?: string
          rate_limit_per_minute?: number
          tier?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_log: {
        Row: {
          call_count: number
          day: string
          endpoint: string
          id: number
          key_hash: string
          last_called: string
        }
        Insert: {
          call_count?: number
          day?: string
          endpoint: string
          id?: never
          key_hash: string
          last_called?: string
        }
        Update: {
          call_count?: number
          day?: string
          endpoint?: string
          id?: never
          key_hash?: string
          last_called?: string
        }
        Relationships: []
      }
      blog_categories: {
        Row: {
          description: string | null
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author: string
          category: string | null
          category_slug: string | null
          content: string
          content_html: string | null
          created_at: string
          excerpt: string
          ghost_post_id: string | null
          ghost_synced_at: string | null
          ghost_uuid: string | null
          hero_image_alt: string | null
          hero_image_url: string | null
          id: number
          is_featured: boolean | null
          meta_description: string | null
          meta_image_url: string | null
          product: string | null
          published_at: string | null
          reading_time_minutes: number | null
          search_vector: unknown
          seo_title: string | null
          slug: string
          source_scam_ids: number[] | null
          status: string | null
          subtitle: string | null
          tags: Json
          title: string
          updated_at: string | null
        }
        Insert: {
          author?: string
          category?: string | null
          category_slug?: string | null
          content: string
          content_html?: string | null
          created_at?: string
          excerpt: string
          ghost_post_id?: string | null
          ghost_synced_at?: string | null
          ghost_uuid?: string | null
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: never
          is_featured?: boolean | null
          meta_description?: string | null
          meta_image_url?: string | null
          product?: string | null
          published_at?: string | null
          reading_time_minutes?: number | null
          search_vector?: unknown
          seo_title?: string | null
          slug: string
          source_scam_ids?: number[] | null
          status?: string | null
          subtitle?: string | null
          tags?: Json
          title: string
          updated_at?: string | null
        }
        Update: {
          author?: string
          category?: string | null
          category_slug?: string | null
          content?: string
          content_html?: string | null
          created_at?: string
          excerpt?: string
          ghost_post_id?: string | null
          ghost_synced_at?: string | null
          ghost_uuid?: string | null
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: never
          is_featured?: boolean | null
          meta_description?: string | null
          meta_image_url?: string | null
          product?: string | null
          published_at?: string | null
          reading_time_minutes?: number | null
          search_vector?: unknown
          seo_title?: string | null
          slug?: string
          source_scam_ids?: number[] | null
          status?: string | null
          subtitle?: string | null
          tags?: Json
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_category_slug_fkey"
            columns: ["category_slug"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["slug"]
          },
        ]
      }
      bot_message_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          images: Json | null
          max_retries: number | null
          message_text: string
          platform: string
          processed_at: string | null
          reply_to: Json | null
          retries: number | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          images?: Json | null
          max_retries?: number | null
          message_text: string
          platform: string
          processed_at?: string | null
          reply_to?: Json | null
          retries?: number | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          images?: Json | null
          max_retries?: number | null
          message_text?: string
          platform?: string
          processed_at?: string | null
          reply_to?: Json | null
          retries?: number | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      brand_aliases: {
        Row: {
          alias_normalized: string
          canonical_brand: string
          created_at: string
          source: string
        }
        Insert: {
          alias_normalized: string
          canonical_brand: string
          created_at?: string
          source?: string
        }
        Update: {
          alias_normalized?: string
          canonical_brand?: string
          created_at?: string
          source?: string
        }
        Relationships: []
      }
      brand_contact_directory: {
        Row: {
          brand: string
          channel_type: string
          evidence_format: string
          evidence_source_url: string | null
          last_notified_at: string | null
          last_verified_at: string
          legitimate_domain: string
          notes: string | null
          recipient: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          channel_type: string
          evidence_format?: string
          evidence_source_url?: string | null
          last_notified_at?: string | null
          last_verified_at?: string
          legitimate_domain: string
          notes?: string | null
          recipient?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          channel_type?: string
          evidence_format?: string
          evidence_source_url?: string | null
          last_notified_at?: string | null
          last_verified_at?: string
          legitimate_domain?: string
          notes?: string | null
          recipient?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      brand_impersonation_alerts: {
        Row: {
          brand_category: string | null
          brand_name: string
          confidence_score: number | null
          created_at: string
          delivery_method: string | null
          draft_post_long: string | null
          draft_post_short: string | null
          evidence_summary: string | null
          facebook_post_id: string | null
          id: number
          linkedin_post_id: string | null
          outreach_contact: string | null
          outreach_sent_at: string | null
          outreach_status: string
          published_at: string | null
          scam_content_hash: string | null
          scam_type: string | null
          scammer_emails: string[] | null
          scammer_phones: string[] | null
          scammer_urls: string[] | null
          twitter_post_id: string | null
        }
        Insert: {
          brand_category?: string | null
          brand_name: string
          confidence_score?: number | null
          created_at?: string
          delivery_method?: string | null
          draft_post_long?: string | null
          draft_post_short?: string | null
          evidence_summary?: string | null
          facebook_post_id?: string | null
          id?: number
          linkedin_post_id?: string | null
          outreach_contact?: string | null
          outreach_sent_at?: string | null
          outreach_status?: string
          published_at?: string | null
          scam_content_hash?: string | null
          scam_type?: string | null
          scammer_emails?: string[] | null
          scammer_phones?: string[] | null
          scammer_urls?: string[] | null
          twitter_post_id?: string | null
        }
        Update: {
          brand_category?: string | null
          brand_name?: string
          confidence_score?: number | null
          created_at?: string
          delivery_method?: string | null
          draft_post_long?: string | null
          draft_post_short?: string | null
          evidence_summary?: string | null
          facebook_post_id?: string | null
          id?: number
          linkedin_post_id?: string | null
          outreach_contact?: string | null
          outreach_sent_at?: string | null
          outreach_status?: string
          published_at?: string | null
          scam_content_hash?: string | null
          scam_type?: string | null
          scammer_emails?: string[] | null
          scammer_phones?: string[] | null
          scammer_urls?: string[] | null
          twitter_post_id?: string | null
        }
        Relationships: []
      }
      brand_impersonation_alerts_archive: {
        Row: {
          brand_category: string | null
          brand_name: string
          confidence_score: number | null
          created_at: string
          delivery_method: string | null
          draft_post_long: string | null
          draft_post_short: string | null
          evidence_summary: string | null
          facebook_post_id: string | null
          id: number
          linkedin_post_id: string | null
          outreach_contact: string | null
          outreach_sent_at: string | null
          outreach_status: string
          published_at: string | null
          scam_content_hash: string | null
          scam_type: string | null
          scammer_emails: string[] | null
          scammer_phones: string[] | null
          scammer_urls: string[] | null
          twitter_post_id: string | null
        }
        Insert: {
          brand_category?: string | null
          brand_name: string
          confidence_score?: number | null
          created_at?: string
          delivery_method?: string | null
          draft_post_long?: string | null
          draft_post_short?: string | null
          evidence_summary?: string | null
          facebook_post_id?: string | null
          id?: number
          linkedin_post_id?: string | null
          outreach_contact?: string | null
          outreach_sent_at?: string | null
          outreach_status?: string
          published_at?: string | null
          scam_content_hash?: string | null
          scam_type?: string | null
          scammer_emails?: string[] | null
          scammer_phones?: string[] | null
          scammer_urls?: string[] | null
          twitter_post_id?: string | null
        }
        Update: {
          brand_category?: string | null
          brand_name?: string
          confidence_score?: number | null
          created_at?: string
          delivery_method?: string | null
          draft_post_long?: string | null
          draft_post_short?: string | null
          evidence_summary?: string | null
          facebook_post_id?: string | null
          id?: number
          linkedin_post_id?: string | null
          outreach_contact?: string | null
          outreach_sent_at?: string | null
          outreach_status?: string
          published_at?: string | null
          scam_content_hash?: string | null
          scam_type?: string | null
          scammer_emails?: string[] | null
          scammer_phones?: string[] | null
          scammer_urls?: string[] | null
          twitter_post_id?: string | null
        }
        Relationships: []
      }
      brand_register: {
        Row: {
          canonical_brand: string
          clone_open_alerts: number
          created_at: string
          cross_stream_priority: number
          curation_status: string | null
          display_name: string
          on_au_watchlist: boolean
          reddit_30d: number
          scam_30d: number
          updated_at: string
        }
        Insert: {
          canonical_brand: string
          clone_open_alerts?: number
          created_at?: string
          cross_stream_priority?: number
          curation_status?: string | null
          display_name: string
          on_au_watchlist?: boolean
          reddit_30d?: number
          scam_30d?: number
          updated_at?: string
        }
        Update: {
          canonical_brand?: string
          clone_open_alerts?: number
          created_at?: string
          cross_stream_priority?: number
          curation_status?: string | null
          display_name?: string
          on_au_watchlist?: boolean
          reddit_30d?: number
          scam_30d?: number
          updated_at?: string
        }
        Relationships: []
      }
      brand_report_unsubscribes: {
        Row: {
          email: string
          source: string | null
          unsubscribed_at: string
        }
        Insert: {
          email: string
          source?: string | null
          unsubscribed_at?: string
        }
        Update: {
          email?: string
          source?: string | null
          unsubscribed_at?: string
        }
        Relationships: []
      }
      brand_stewardship_reports: {
        Row: {
          approved_by_admin_id: string | null
          brand_key: string
          brand_name: string
          created_at: string
          evidence_scam_report_ids: number[]
          id: string
          metrics: Json
          outreach_done_at: string | null
          outreach_done_by: string | null
          period_month: string
          prepared_at: string
          provider: string | null
          provider_message_id: string | null
          recipient_email: string | null
          sent_at: string | null
          share_token: string
          status: string
          status_reason: string | null
        }
        Insert: {
          approved_by_admin_id?: string | null
          brand_key: string
          brand_name: string
          created_at?: string
          evidence_scam_report_ids?: number[]
          id?: string
          metrics?: Json
          outreach_done_at?: string | null
          outreach_done_by?: string | null
          period_month: string
          prepared_at?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          share_token?: string
          status?: string
          status_reason?: string | null
        }
        Update: {
          approved_by_admin_id?: string | null
          brand_key?: string
          brand_name?: string
          created_at?: string
          evidence_scam_report_ids?: number[]
          id?: string
          metrics?: Json
          outreach_done_at?: string | null
          outreach_done_by?: string | null
          period_month?: string
          prepared_at?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          share_token?: string
          status?: string
          status_reason?: string | null
        }
        Relationships: []
      }
      breach_sources_raw: {
        Row: {
          breach_id: number | null
          captured_at: string
          id: number
          is_verified: boolean | null
          raw_content: Json
          raw_content_v: number
          source_actor: string | null
          source_type: string
          source_url: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          breach_id?: number | null
          captured_at?: string
          id?: never
          is_verified?: boolean | null
          raw_content: Json
          raw_content_v?: number
          source_actor?: string | null
          source_type: string
          source_url?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          breach_id?: number | null
          captured_at?: string
          id?: never
          is_verified?: boolean | null
          raw_content?: Json
          raw_content_v?: number
          source_actor?: string | null
          source_type?: string
          source_url?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breach_sources_raw_breach_id_fkey"
            columns: ["breach_id"]
            isOneToOne: false
            referencedRelation: "breaches"
            referencedColumns: ["id"]
          },
        ]
      }
      breach_victims_index: {
        Row: {
          breach_id: number
          created_at: string
          data_classes_present: string[]
          id: number
          identifier_hash: string
          identifier_type: string
          source_evidence: string | null
        }
        Insert: {
          breach_id: number
          created_at?: string
          data_classes_present?: string[]
          id?: never
          identifier_hash: string
          identifier_type: string
          source_evidence?: string | null
        }
        Update: {
          breach_id?: number
          created_at?: string
          data_classes_present?: string[]
          id?: never
          identifier_hash?: string
          identifier_type?: string
          source_evidence?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breach_victims_index_breach_id_fkey"
            columns: ["breach_id"]
            isOneToOne: false
            referencedRelation: "breaches"
            referencedColumns: ["id"]
          },
        ]
      }
      breaches: {
        Row: {
          abn: string | null
          asic_acn: string | null
          attack_vector: string | null
          au_doc_classes: string[]
          created_at: string
          created_by: string | null
          data_classes: string[]
          data_published: boolean | null
          data_volume_gb: number | null
          disclosed_at: string | null
          discovered_at: string | null
          dls_listed_at: string | null
          entity_domain: string | null
          entity_name: string
          id: number
          industry: string | null
          industry_code: string | null
          is_published: boolean
          is_redacted: boolean
          jurisdiction: string
          last_edited_by: string | null
          ndb_status: string | null
          oaic_notified_at: string | null
          primary_source_url: string | null
          ransom_currency: string | null
          ransom_demanded: number | null
          recovery_advice: string | null
          redaction_reason: string | null
          slug: string
          sources: Json
          sources_v: number
          state: string | null
          status: string
          summary: string | null
          threat_actor: string | null
          threat_actor_type: string | null
          updated_at: string
          victim_count_claimed: number | null
          victim_count_confirmed: number | null
        }
        Insert: {
          abn?: string | null
          asic_acn?: string | null
          attack_vector?: string | null
          au_doc_classes?: string[]
          created_at?: string
          created_by?: string | null
          data_classes?: string[]
          data_published?: boolean | null
          data_volume_gb?: number | null
          disclosed_at?: string | null
          discovered_at?: string | null
          dls_listed_at?: string | null
          entity_domain?: string | null
          entity_name: string
          id?: never
          industry?: string | null
          industry_code?: string | null
          is_published?: boolean
          is_redacted?: boolean
          jurisdiction?: string
          last_edited_by?: string | null
          ndb_status?: string | null
          oaic_notified_at?: string | null
          primary_source_url?: string | null
          ransom_currency?: string | null
          ransom_demanded?: number | null
          recovery_advice?: string | null
          redaction_reason?: string | null
          slug: string
          sources?: Json
          sources_v?: number
          state?: string | null
          status?: string
          summary?: string | null
          threat_actor?: string | null
          threat_actor_type?: string | null
          updated_at?: string
          victim_count_claimed?: number | null
          victim_count_confirmed?: number | null
        }
        Update: {
          abn?: string | null
          asic_acn?: string | null
          attack_vector?: string | null
          au_doc_classes?: string[]
          created_at?: string
          created_by?: string | null
          data_classes?: string[]
          data_published?: boolean | null
          data_volume_gb?: number | null
          disclosed_at?: string | null
          discovered_at?: string | null
          dls_listed_at?: string | null
          entity_domain?: string | null
          entity_name?: string
          id?: never
          industry?: string | null
          industry_code?: string | null
          is_published?: boolean
          is_redacted?: boolean
          jurisdiction?: string
          last_edited_by?: string | null
          ndb_status?: string | null
          oaic_notified_at?: string | null
          primary_source_url?: string | null
          ransom_currency?: string | null
          ransom_demanded?: number | null
          recovery_advice?: string | null
          redaction_reason?: string | null
          slug?: string
          sources?: Json
          sources_v?: number
          state?: string | null
          status?: string
          summary?: string | null
          threat_actor?: string | null
          threat_actor_type?: string | null
          updated_at?: string
          victim_count_claimed?: number | null
          victim_count_confirmed?: number | null
        }
        Relationships: []
      }
      check_stats: {
        Row: {
          created_at: string
          date: string
          high_risk_count: number
          id: number
          region: string
          safe_count: number
          suspicious_count: number
          total_checks: number
        }
        Insert: {
          created_at?: string
          date?: string
          high_risk_count?: number
          id?: never
          region?: string
          safe_count?: number
          suspicious_count?: number
          total_checks?: number
        }
        Update: {
          created_at?: string
          date?: string
          high_risk_count?: number
          id?: never
          region?: string
          safe_count?: number
          suspicious_count?: number
          total_checks?: number
        }
        Relationships: []
      }
      clone_alert_brand_replies: {
        Row: {
          alert_id: number | null
          body_excerpt: string | null
          brand: string | null
          classified_as: string
          from_email: string
          id: number
          meta: Json
          raw_message_id: string | null
          received_at: string
          subject: string | null
        }
        Insert: {
          alert_id?: number | null
          body_excerpt?: string | null
          brand?: string | null
          classified_as?: string
          from_email: string
          id?: number
          meta?: Json
          raw_message_id?: string | null
          received_at?: string
          subject?: string | null
        }
        Update: {
          alert_id?: number | null
          body_excerpt?: string | null
          brand?: string | null
          classified_as?: string
          from_email?: string
          id?: number
          meta?: Json
          raw_message_id?: string | null
          received_at?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clone_alert_brand_replies_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "shopfront_clone_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_alert_notification_queue: {
        Row: {
          alert_id: number
          approval_status: string
          approval_url: string | null
          approved_at: string | null
          approved_by_admin_id: string | null
          batch_id: string | null
          brand: string
          candidate_domain: string
          candidate_url: string
          channel_type: string
          email_body_html: string | null
          email_subject: string | null
          enqueued_at: string
          id: number
          prepared_at: string | null
          processed_at: string | null
          provider_message_id: string | null
          recipient: string
          rejected_by_admin_id: string | null
          scheduled_for: string
          severity_tier: string
          status: string
        }
        Insert: {
          alert_id: number
          approval_status?: string
          approval_url?: string | null
          approved_at?: string | null
          approved_by_admin_id?: string | null
          batch_id?: string | null
          brand: string
          candidate_domain: string
          candidate_url: string
          channel_type: string
          email_body_html?: string | null
          email_subject?: string | null
          enqueued_at?: string
          id?: number
          prepared_at?: string | null
          processed_at?: string | null
          provider_message_id?: string | null
          recipient: string
          rejected_by_admin_id?: string | null
          scheduled_for: string
          severity_tier: string
          status?: string
        }
        Update: {
          alert_id?: number
          approval_status?: string
          approval_url?: string | null
          approved_at?: string | null
          approved_by_admin_id?: string | null
          batch_id?: string | null
          brand?: string
          candidate_domain?: string
          candidate_url?: string
          channel_type?: string
          email_body_html?: string | null
          email_subject?: string | null
          enqueued_at?: string
          id?: number
          prepared_at?: string | null
          processed_at?: string | null
          provider_message_id?: string | null
          recipient?: string
          rejected_by_admin_id?: string | null
          scheduled_for?: string
          severity_tier?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "clone_alert_notification_queue_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "shopfront_clone_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clone_alert_notification_queue_brand_fkey"
            columns: ["brand"]
            isOneToOne: false
            referencedRelation: "brand_contact_directory"
            referencedColumns: ["brand"]
          },
        ]
      }
      clone_watch_classifications: {
        Row: {
          alert_id: number
          attack_intent: string | null
          brand: string
          candidate_domain: string
          classified_at: string
          clone_tactic: string | null
          confidence: number
          input_tokens: number | null
          is_clone: boolean
          model_id: string
          output_tokens: number | null
          prompt_version: string
          reason: string
          risk_indicators: Json
        }
        Insert: {
          alert_id: number
          attack_intent?: string | null
          brand: string
          candidate_domain: string
          classified_at?: string
          clone_tactic?: string | null
          confidence: number
          input_tokens?: number | null
          is_clone: boolean
          model_id: string
          output_tokens?: number | null
          prompt_version: string
          reason: string
          risk_indicators?: Json
        }
        Update: {
          alert_id?: number
          attack_intent?: string | null
          brand?: string
          candidate_domain?: string
          classified_at?: string
          clone_tactic?: string | null
          confidence?: number
          input_tokens?: number | null
          is_clone?: boolean
          model_id?: string
          output_tokens?: number | null
          prompt_version?: string
          reason?: string
          risk_indicators?: Json
        }
        Relationships: [
          {
            foreignKeyName: "clone_watch_classifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: true
            referencedRelation: "shopfront_clone_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      clone_watch_disputes: {
        Row: {
          claim: string
          created_at: string
          disputant: string | null
          evidence: Json
          id: string
          notes: string | null
          resolution: string
          resolved_at: string | null
          subject: string
          subject_type: string
        }
        Insert: {
          claim: string
          created_at?: string
          disputant?: string | null
          evidence?: Json
          id?: string
          notes?: string | null
          resolution?: string
          resolved_at?: string | null
          subject: string
          subject_type: string
        }
        Update: {
          claim?: string
          created_at?: string
          disputant?: string | null
          evidence?: Json
          id?: string
          notes?: string | null
          resolution?: string
          resolved_at?: string | null
          subject?: string
          subject_type?: string
        }
        Relationships: []
      }
      clone_watch_monthly_brand_stats: {
        Row: {
          brand: string
          clones: number
          declined: number
          escalated: number
          is_au: boolean
          likely_phishing: number
          parked: number
          period_month: string
          reported_to_netcraft: number
          taken_down: number
          weaponised: number
        }
        Insert: {
          brand: string
          clones?: number
          declined?: number
          escalated?: number
          is_au?: boolean
          likely_phishing?: number
          parked?: number
          period_month: string
          reported_to_netcraft?: number
          taken_down?: number
          weaponised?: number
        }
        Update: {
          brand?: string
          clones?: number
          declined?: number
          escalated?: number
          is_au?: boolean
          likely_phishing?: number
          parked?: number
          period_month?: string
          reported_to_netcraft?: number
          taken_down?: number
          weaponised?: number
        }
        Relationships: []
      }
      clone_watch_monthly_registrar_stats: {
        Row: {
          clones: number
          period_month: string
          registrar: string
        }
        Insert: {
          clones?: number
          period_month: string
          registrar: string
        }
        Update: {
          clones?: number
          period_month?: string
          registrar?: string
        }
        Relationships: []
      }
      clone_watch_report_summary: {
        Row: {
          brand_count: number
          declined: number
          escalated: number
          generated_at: string
          global_brands: Json
          likely_phishing: number
          mom: Json | null
          parked_for_sale: number
          period_month: string
          published_post_urn: string | null
          re_taken_down: number
          reported_to_netcraft: number
          super_fund: Json | null
          taken_down: number
          top_au_brands: Json
          top_registrars: Json
          total_domains: number
          unknown_registrar_count: number
          updated_at: string
          weaponised: number
        }
        Insert: {
          brand_count?: number
          declined?: number
          escalated?: number
          generated_at?: string
          global_brands?: Json
          likely_phishing?: number
          mom?: Json | null
          parked_for_sale?: number
          period_month: string
          published_post_urn?: string | null
          re_taken_down?: number
          reported_to_netcraft?: number
          super_fund?: Json | null
          taken_down?: number
          top_au_brands?: Json
          top_registrars?: Json
          total_domains?: number
          unknown_registrar_count?: number
          updated_at?: string
          weaponised?: number
        }
        Update: {
          brand_count?: number
          declined?: number
          escalated?: number
          generated_at?: string
          global_brands?: Json
          likely_phishing?: number
          mom?: Json | null
          parked_for_sale?: number
          period_month?: string
          published_post_urn?: string | null
          re_taken_down?: number
          reported_to_netcraft?: number
          super_fund?: Json | null
          taken_down?: number
          top_au_brands?: Json
          top_registrars?: Json
          total_domains?: number
          unknown_registrar_count?: number
          updated_at?: string
          weaponised?: number
        }
        Relationships: []
      }
      cluster_members: {
        Row: {
          cluster_id: number
          created_at: string
          id: number
          report_id: number
        }
        Insert: {
          cluster_id: number
          created_at?: string
          id?: never
          report_id: number
        }
        Update: {
          cluster_id?: number
          created_at?: string
          id?: never
          report_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "scam_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "threat_intel_scam_campaigns"
            referencedColumns: ["cluster_id"]
          },
          {
            foreignKeyName: "cluster_members_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_reports_archive: {
        Row: {
          archived_at: string
          cluster_id: number
          created_at: string
          id: number
          report_id: number
        }
        Insert: {
          archived_at?: string
          cluster_id: number
          created_at: string
          id: number
          report_id: number
        }
        Update: {
          archived_at?: string
          cluster_id?: number
          created_at?: string
          id?: number
          report_id?: number
        }
        Relationships: []
      }
      competitor_intel_observations: {
        Row: {
          brands: string[]
          confidence: number | null
          country_code: string | null
          created_at: string
          extracted_at: string
          feed_item_id: number
          id: number
          model_version: string | null
          novelty: string | null
          prompt_version: string | null
          scam_title: string
          scam_type: string | null
          source: string
          summary: string
          tactic: string | null
        }
        Insert: {
          brands?: string[]
          confidence?: number | null
          country_code?: string | null
          created_at?: string
          extracted_at?: string
          feed_item_id: number
          id?: never
          model_version?: string | null
          novelty?: string | null
          prompt_version?: string | null
          scam_title: string
          scam_type?: string | null
          source: string
          summary: string
          tactic?: string | null
        }
        Update: {
          brands?: string[]
          confidence?: number | null
          country_code?: string | null
          created_at?: string
          extracted_at?: string
          feed_item_id?: number
          id?: never
          model_version?: string | null
          novelty?: string | null
          prompt_version?: string | null
          scam_title?: string
          scam_type?: string | null
          source?: string
          summary?: string
          tactic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_intel_observations_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_telemetry: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: string
          metadata: Json
          metadata_v: number
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number
          units: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd?: number
          feature: string
          id?: string
          metadata?: Json
          metadata_v?: number
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number
          units?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: string
          metadata?: Json
          metadata_v?: number
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number
          units?: number
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_daily_rollup: {
        Row: {
          avg_cost_usd: number | null
          day: string
          event_count: number
          feature: string
          provider: string
          rolled_up_at: string
          total_cost_usd: number
        }
        Insert: {
          avg_cost_usd?: number | null
          day: string
          event_count?: number
          feature: string
          provider: string
          rolled_up_at?: string
          total_cost_usd?: number
        }
        Update: {
          avg_cost_usd?: number | null
          day?: string
          event_count?: number
          feature?: string
          provider?: string
          rolled_up_at?: string
          total_cost_usd?: number
        }
        Relationships: []
      }
      cost_telemetry_partitioned: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m01: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m02: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m03: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m04: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m05: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      cost_telemetry_partitioned_y2026m06: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          feature: string
          id: number
          metadata: Json
          operation: string
          provider: string
          request_id: string | null
          unit_cost_usd: number | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd: number
          feature: string
          id?: never
          metadata?: Json
          operation: string
          provider: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          feature?: string
          id?: never
          metadata?: Json
          operation?: string
          provider?: string
          request_id?: string | null
          unit_cost_usd?: number | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      deepfake_detections: {
        Row: {
          ad_text_excerpt: string | null
          advertiser_name: string | null
          ai_confidence: number | null
          celebrity_id: number | null
          celebrity_name: string
          created_at: string | null
          deepfake_confidence: number | null
          flagged_ad_id: number | null
          generator_source: string | null
          hive_result: Json | null
          id: number
          image_url: string
          landing_url: string | null
          meta_report_id: string | null
          reported_at: string | null
          reported_to_meta: boolean | null
          screenshot_key: string | null
        }
        Insert: {
          ad_text_excerpt?: string | null
          advertiser_name?: string | null
          ai_confidence?: number | null
          celebrity_id?: number | null
          celebrity_name: string
          created_at?: string | null
          deepfake_confidence?: number | null
          flagged_ad_id?: number | null
          generator_source?: string | null
          hive_result?: Json | null
          id?: never
          image_url: string
          landing_url?: string | null
          meta_report_id?: string | null
          reported_at?: string | null
          reported_to_meta?: boolean | null
          screenshot_key?: string | null
        }
        Update: {
          ad_text_excerpt?: string | null
          advertiser_name?: string | null
          ai_confidence?: number | null
          celebrity_id?: number | null
          celebrity_name?: string
          created_at?: string | null
          deepfake_confidence?: number | null
          flagged_ad_id?: number | null
          generator_source?: string | null
          hive_result?: Json | null
          id?: never
          image_url?: string
          landing_url?: string | null
          meta_report_id?: string | null
          reported_at?: string | null
          reported_to_meta?: boolean | null
          screenshot_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deepfake_detections_celebrity_id_fkey"
            columns: ["celebrity_id"]
            isOneToOne: false
            referencedRelation: "monitored_celebrities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deepfake_detections_flagged_ad_id_fkey"
            columns: ["flagged_ad_id"]
            isOneToOne: false
            referencedRelation: "flagged_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      deepfake_detections_archive: {
        Row: {
          ad_text_excerpt: string | null
          advertiser_name: string | null
          ai_confidence: number | null
          celebrity_id: number | null
          celebrity_name: string
          created_at: string | null
          deepfake_confidence: number | null
          flagged_ad_id: number | null
          generator_source: string | null
          hive_result: Json | null
          id: number
          image_url: string
          landing_url: string | null
          meta_report_id: string | null
          reported_at: string | null
          reported_to_meta: boolean | null
          screenshot_key: string | null
        }
        Insert: {
          ad_text_excerpt?: string | null
          advertiser_name?: string | null
          ai_confidence?: number | null
          celebrity_id?: number | null
          celebrity_name: string
          created_at?: string | null
          deepfake_confidence?: number | null
          flagged_ad_id?: number | null
          generator_source?: string | null
          hive_result?: Json | null
          id: number
          image_url: string
          landing_url?: string | null
          meta_report_id?: string | null
          reported_at?: string | null
          reported_to_meta?: boolean | null
          screenshot_key?: string | null
        }
        Update: {
          ad_text_excerpt?: string | null
          advertiser_name?: string | null
          ai_confidence?: number | null
          celebrity_id?: number | null
          celebrity_name?: string
          created_at?: string | null
          deepfake_confidence?: number | null
          flagged_ad_id?: number | null
          generator_source?: string | null
          hive_result?: Json | null
          id?: number
          image_url?: string
          landing_url?: string | null
          meta_report_id?: string | null
          reported_at?: string | null
          reported_to_meta?: boolean | null
          screenshot_key?: string | null
        }
        Relationships: []
      }
      device_push_tokens: {
        Row: {
          active: boolean
          created_at: string
          device_id: string
          expo_token: string
          id: number
          last_seen: string
          platform: string
          region: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_id: string
          expo_token: string
          id?: never
          last_seen?: string
          platform: string
          region?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          device_id?: string
          expo_token?: string
          id?: never
          last_seen?: string
          platform?: string
          region?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      device_swap_events: {
        Row: {
          cost_usd: number | null
          created_at: string
          id: number
          latency_ms: number | null
          max_age_checked: number | null
          msisdn_e164: string
          msisdn_hash: string
          raw_response: Json
          source: string
          swap_date: string | null
          swapped: boolean
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          max_age_checked?: number | null
          msisdn_e164: string
          msisdn_hash: string
          raw_response?: Json
          source: string
          swap_date?: string | null
          swapped: boolean
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          max_age_checked?: number | null
          msisdn_e164?: string
          msisdn_hash?: string
          raw_response?: Json
          source?: string
          swap_date?: string | null
          swapped?: boolean
        }
        Relationships: []
      }
      email_copy: {
        Row: {
          content_md: string
          slot_key: string
          template_key: string
          updated_at: string
          updated_by_admin_id: string | null
        }
        Insert: {
          content_md: string
          slot_key: string
          template_key: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Update: {
          content_md?: string
          slot_key?: string
          template_key?: string
          updated_at?: string
          updated_by_admin_id?: string | null
        }
        Relationships: []
      }
      email_copy_history: {
        Row: {
          content_md: string
          edited_at: string
          edited_by_admin_id: string | null
          id: string
          slot_key: string
          template_key: string
        }
        Insert: {
          content_md: string
          edited_at?: string
          edited_by_admin_id?: string | null
          id?: string
          slot_key: string
          template_key: string
        }
        Update: {
          content_md?: string
          edited_at?: string
          edited_by_admin_id?: string | null
          id?: string
          slot_key?: string
          template_key?: string
        }
        Relationships: []
      }
      email_subscribers: {
        Row: {
          consent_at: string | null
          consent_source: string | null
          created_at: string
          email: string
          id: number
          is_active: boolean
          updated_at: string
        }
        Insert: {
          consent_at?: string | null
          consent_source?: string | null
          created_at?: string
          email: string
          id?: never
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          consent_at?: string | null
          consent_source?: string | null
          created_at?: string
          email?: string
          id?: never
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      extension_installs: {
        Row: {
          install_id: string
          ip_hash: string | null
          last_seen_at: string
          public_key_jwk: Json
          registered_at: string
          revoked: boolean
          revoked_reason: string | null
          turnstile_country: string | null
        }
        Insert: {
          install_id: string
          ip_hash?: string | null
          last_seen_at?: string
          public_key_jwk: Json
          registered_at?: string
          revoked?: boolean
          revoked_reason?: string | null
          turnstile_country?: string | null
        }
        Update: {
          install_id?: string
          ip_hash?: string | null
          last_seen_at?: string
          public_key_jwk?: Json
          registered_at?: string
          revoked?: boolean
          revoked_reason?: string | null
          turnstile_country?: string | null
        }
        Relationships: []
      }
      extension_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: number
          install_id: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          status: string
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: never
          install_id: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: never
          install_id?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_subscriptions_install_id_fkey"
            columns: ["install_id"]
            isOneToOne: true
            referencedRelation: "extension_installs"
            referencedColumns: ["install_id"]
          },
        ]
      }
      family_activity_log: {
        Row: {
          created_at: string
          event_type: string
          group_id: string
          id: number
          member_id: string | null
          metadata: Json | null
          metadata_v: number
          summary: string
        }
        Insert: {
          created_at?: string
          event_type: string
          group_id: string
          id?: never
          member_id?: string | null
          metadata?: Json | null
          metadata_v?: number
          summary: string
        }
        Update: {
          created_at?: string
          event_type?: string
          group_id?: string
          id?: never
          member_id?: string | null
          metadata?: Json | null
          metadata_v?: number
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_activity_log_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_activity_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      family_groups: {
        Row: {
          created_at: string
          id: string
          max_members: number
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_members?: number
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_members?: number
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          email: string
          group_id: string
          id: string
          invite_code: string | null
          joined_at: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          group_id: string
          id?: string
          invite_code?: string | null
          joined_at?: string | null
          role?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          group_id?: string
          id?: string
          invite_code?: string | null
          joined_at?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_brakes: {
        Row: {
          feature: string
          paused_until: string
          reason: string | null
          set_at: string
          set_by: string | null
          set_cost_usd: number | null
          set_threshold_usd: number | null
        }
        Insert: {
          feature: string
          paused_until: string
          reason?: string | null
          set_at?: string
          set_by?: string | null
          set_cost_usd?: number | null
          set_threshold_usd?: number | null
        }
        Update: {
          feature?: string
          paused_until?: string
          reason?: string | null
          set_at?: string
          set_by?: string | null
          set_cost_usd?: number | null
          set_threshold_usd?: number | null
        }
        Relationships: []
      }
      feed_http_cache: {
        Row: {
          etag: string | null
          fetched_at: string
          last_modified: string | null
          source: string
          status_code: number
          url: string
        }
        Insert: {
          etag?: string | null
          fetched_at?: string
          last_modified?: string | null
          source: string
          status_code: number
          url: string
        }
        Update: {
          etag?: string | null
          fetched_at?: string
          last_modified?: string | null
          source?: string
          status_code?: number
          url?: string
        }
        Relationships: []
      }
      feed_ingestion_log: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          error_message: string | null
          feed_name: string
          id: number
          record_type: string | null
          records_fetched: number | null
          records_new: number | null
          records_skipped: number | null
          records_updated: number | null
          status: string
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          feed_name: string
          id?: never
          record_type?: string | null
          records_fetched?: number | null
          records_new?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          status: string
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          feed_name?: string
          id?: never
          record_type?: string | null
          records_fetched?: number | null
          records_new?: number | null
          records_skipped?: number | null
          records_updated?: number | null
          status?: string
        }
        Relationships: []
      }
      feed_items: {
        Row: {
          body_md: string | null
          category: string | null
          channel: string | null
          competitor_extracted_at: string | null
          country_code: string | null
          created_at: string | null
          description: string | null
          embedding: string | null
          embedding_model_version: string | null
          evidence_r2_key: string | null
          external_id: string | null
          has_image: boolean | null
          id: number
          impersonated_brand: string | null
          provenance_tier:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published: boolean | null
          published_at: string | null
          r2_image_key: string | null
          reddit_image_url: string | null
          source: string
          source_created_at: string | null
          source_url: string | null
          tags: string[] | null
          title: string
          upvotes: number | null
          url: string | null
          verified: boolean | null
        }
        Insert: {
          body_md?: string | null
          category?: string | null
          channel?: string | null
          competitor_extracted_at?: string | null
          country_code?: string | null
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          embedding_model_version?: string | null
          evidence_r2_key?: string | null
          external_id?: string | null
          has_image?: boolean | null
          id?: never
          impersonated_brand?: string | null
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published?: boolean | null
          published_at?: string | null
          r2_image_key?: string | null
          reddit_image_url?: string | null
          source: string
          source_created_at?: string | null
          source_url?: string | null
          tags?: string[] | null
          title: string
          upvotes?: number | null
          url?: string | null
          verified?: boolean | null
        }
        Update: {
          body_md?: string | null
          category?: string | null
          channel?: string | null
          competitor_extracted_at?: string | null
          country_code?: string | null
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          embedding_model_version?: string | null
          evidence_r2_key?: string | null
          external_id?: string | null
          has_image?: boolean | null
          id?: never
          impersonated_brand?: string | null
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published?: boolean | null
          published_at?: string | null
          r2_image_key?: string | null
          reddit_image_url?: string | null
          source?: string
          source_created_at?: string | null
          source_url?: string | null
          tags?: string[] | null
          title?: string
          upvotes?: number | null
          url?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      feed_items_archive: {
        Row: {
          archived_at: string
          body_md: string | null
          category: string | null
          channel: string | null
          country_code: string | null
          created_at: string
          description: string | null
          embedding_model_version: string | null
          evidence_r2_key: string | null
          external_id: string | null
          has_image: boolean | null
          id: number
          impersonated_brand: string | null
          provenance_tier:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published: boolean | null
          published_at: string | null
          r2_image_key: string | null
          reddit_image_url: string | null
          source: string
          source_created_at: string | null
          source_url: string | null
          tags: string[] | null
          title: string
          upvotes: number | null
          url: string | null
          verified: boolean | null
        }
        Insert: {
          archived_at?: string
          body_md?: string | null
          category?: string | null
          channel?: string | null
          country_code?: string | null
          created_at: string
          description?: string | null
          embedding_model_version?: string | null
          evidence_r2_key?: string | null
          external_id?: string | null
          has_image?: boolean | null
          id: number
          impersonated_brand?: string | null
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published?: boolean | null
          published_at?: string | null
          r2_image_key?: string | null
          reddit_image_url?: string | null
          source: string
          source_created_at?: string | null
          source_url?: string | null
          tags?: string[] | null
          title: string
          upvotes?: number | null
          url?: string | null
          verified?: boolean | null
        }
        Update: {
          archived_at?: string
          body_md?: string | null
          category?: string | null
          channel?: string | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          embedding_model_version?: string | null
          evidence_r2_key?: string | null
          external_id?: string | null
          has_image?: boolean | null
          id?: number
          impersonated_brand?: string | null
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published?: boolean | null
          published_at?: string | null
          r2_image_key?: string | null
          reddit_image_url?: string | null
          source?: string
          source_created_at?: string | null
          source_url?: string | null
          tags?: string[] | null
          title?: string
          upvotes?: number | null
          url?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      feed_items_partitioned: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m01: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m02: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m03: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m04: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m05: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_items_partitioned_y2026m06: {
        Row: {
          category: string | null
          country: string | null
          created_at: string
          description: string | null
          feed_name: string
          id: number
          metadata: Json
          published: boolean
          published_at: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          category?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          feed_name?: string
          id?: never
          metadata?: Json
          published?: boolean
          published_at?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      feed_sources: {
        Row: {
          category: string
          consecutive_failures: number
          created_at: string
          enabled: boolean
          id: string
          jurisdiction: string
          last_fetched_at: string | null
          last_success_at: string | null
          name: string
          notes: string | null
          poll_schedule: string | null
          slug: string
          source_type: string
          updated_at: string
          url: string | null
        }
        Insert: {
          category: string
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          id?: string
          jurisdiction?: string
          last_fetched_at?: string | null
          last_success_at?: string | null
          name: string
          notes?: string | null
          poll_schedule?: string | null
          slug: string
          source_type: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          category?: string
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          id?: string
          jurisdiction?: string
          last_fetched_at?: string | null
          last_success_at?: string | null
          name?: string
          notes?: string | null
          poll_schedule?: string | null
          slug?: string
          source_type?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      feed_summaries: {
        Row: {
          created_at: string
          id: number
          new_items_count: number
          scrape_date: string
          stats: Json
          summary_text: string
        }
        Insert: {
          created_at?: string
          id?: number
          new_items_count?: number
          scrape_date: string
          stats?: Json
          summary_text: string
        }
        Update: {
          created_at?: string
          id?: number
          new_items_count?: number
          scrape_date?: string
          stats?: Json
          summary_text?: string
        }
        Relationships: []
      }
      flagged_ads: {
        Row: {
          ad_text_hash: string
          advertiser_name: string | null
          ai_generated_image: boolean | null
          deepfake_detected: boolean | null
          first_seen_at: string | null
          flag_count: number | null
          hive_result: Json | null
          id: number
          impersonated_celebrity: string | null
          landing_page_domain: string | null
          landing_url: string | null
          last_flagged_at: string | null
          reporter_hashes: string[] | null
          risk_score: number | null
          status: string | null
          verdict: string | null
        }
        Insert: {
          ad_text_hash: string
          advertiser_name?: string | null
          ai_generated_image?: boolean | null
          deepfake_detected?: boolean | null
          first_seen_at?: string | null
          flag_count?: number | null
          hive_result?: Json | null
          id?: never
          impersonated_celebrity?: string | null
          landing_page_domain?: string | null
          landing_url?: string | null
          last_flagged_at?: string | null
          reporter_hashes?: string[] | null
          risk_score?: number | null
          status?: string | null
          verdict?: string | null
        }
        Update: {
          ad_text_hash?: string
          advertiser_name?: string | null
          ai_generated_image?: boolean | null
          deepfake_detected?: boolean | null
          first_seen_at?: string | null
          flag_count?: number | null
          hive_result?: Json | null
          id?: never
          impersonated_celebrity?: string | null
          landing_page_domain?: string | null
          landing_url?: string | null
          last_flagged_at?: string | null
          reporter_hashes?: string[] | null
          risk_score?: number | null
          status?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      flagged_ads_archive: {
        Row: {
          ad_text_hash: string
          advertiser_name: string | null
          ai_generated_image: boolean | null
          deepfake_detected: boolean | null
          first_seen_at: string | null
          flag_count: number | null
          hive_result: Json | null
          id: number
          impersonated_celebrity: string | null
          landing_page_domain: string | null
          landing_url: string | null
          last_flagged_at: string | null
          reporter_hashes: string[] | null
          risk_score: number | null
          status: string | null
          verdict: string | null
        }
        Insert: {
          ad_text_hash: string
          advertiser_name?: string | null
          ai_generated_image?: boolean | null
          deepfake_detected?: boolean | null
          first_seen_at?: string | null
          flag_count?: number | null
          hive_result?: Json | null
          id: number
          impersonated_celebrity?: string | null
          landing_page_domain?: string | null
          landing_url?: string | null
          last_flagged_at?: string | null
          reporter_hashes?: string[] | null
          risk_score?: number | null
          status?: string | null
          verdict?: string | null
        }
        Update: {
          ad_text_hash?: string
          advertiser_name?: string | null
          ai_generated_image?: boolean | null
          deepfake_detected?: boolean | null
          first_seen_at?: string | null
          flag_count?: number | null
          hive_result?: Json | null
          id?: number
          impersonated_celebrity?: string | null
          landing_page_domain?: string | null
          landing_url?: string | null
          last_flagged_at?: string | null
          reporter_hashes?: string[] | null
          risk_score?: number | null
          status?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      infra_cost_daily: {
        Row: {
          date: string
          ingested_at: string
          provider: string
          raw_usage_jsonb: Json | null
          usd_cents: number
        }
        Insert: {
          date: string
          ingested_at?: string
          provider: string
          raw_usage_jsonb?: Json | null
          usd_cents: number
        }
        Update: {
          date?: string
          ingested_at?: string
          provider?: string
          raw_usage_jsonb?: Json | null
          usd_cents?: number
        }
        Relationships: []
      }
      known_brands: {
        Row: {
          brand_category: string | null
          brand_domain: string | null
          brand_key: string | null
          brand_name: string
          contact_type: string
          evidence_format: string | null
          id: number
          is_active: boolean
          last_verified_at: string | null
          notes: string | null
          security_contact_email: string | null
          security_contact_url: string | null
          source_url: string | null
          verified_by: string | null
        }
        Insert: {
          brand_category?: string | null
          brand_domain?: string | null
          brand_key?: string | null
          brand_name: string
          contact_type?: string
          evidence_format?: string | null
          id?: number
          is_active?: boolean
          last_verified_at?: string | null
          notes?: string | null
          security_contact_email?: string | null
          security_contact_url?: string | null
          source_url?: string | null
          verified_by?: string | null
        }
        Update: {
          brand_category?: string | null
          brand_domain?: string | null
          brand_key?: string | null
          brand_name?: string
          contact_type?: string
          evidence_format?: string | null
          id?: number
          is_active?: boolean
          last_verified_at?: string | null
          notes?: string | null
          security_contact_email?: string | null
          security_contact_url?: string | null
          source_url?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          abn: string | null
          assessment_data: Json | null
          company_name: string
          created_at: string
          email: string
          id: number
          name: string
          notes: Json
          nurture_last_sent_at: string | null
          nurture_step: number
          phone: string | null
          role_title: string | null
          score: number
          sector: string | null
          source: string
          status: string
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          abn?: string | null
          assessment_data?: Json | null
          company_name: string
          created_at?: string
          email: string
          id?: never
          name: string
          notes?: Json
          nurture_last_sent_at?: string | null
          nurture_step?: number
          phone?: string | null
          role_title?: string | null
          score?: number
          sector?: string | null
          source?: string
          status?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          abn?: string | null
          assessment_data?: Json | null
          company_name?: string
          created_at?: string
          email?: string
          id?: never
          name?: string
          notes?: Json
          nurture_last_sent_at?: string | null
          nurture_step?: number
          phone?: string | null
          role_title?: string | null
          score?: number
          sector?: string | null
          source?: string
          status?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      media_analyses: {
        Row: {
          channel: string | null
          confidence: number | null
          created_at: string | null
          deepfake_provider: string | null
          deepfake_raw: Json | null
          deepfake_raw_v: number
          deepfake_score: number | null
          error_message: string | null
          id: string
          impersonated_brand: string | null
          injection_detected: boolean | null
          job_id: string
          media_type: string
          next_steps: Json | null
          phone_numbers: Json | null
          r2_key: string
          red_flags: Json | null
          scam_type: string | null
          status: string
          summary: string | null
          transcript: string | null
          updated_at: string | null
          verdict: string | null
        }
        Insert: {
          channel?: string | null
          confidence?: number | null
          created_at?: string | null
          deepfake_provider?: string | null
          deepfake_raw?: Json | null
          deepfake_raw_v?: number
          deepfake_score?: number | null
          error_message?: string | null
          id?: string
          impersonated_brand?: string | null
          injection_detected?: boolean | null
          job_id: string
          media_type?: string
          next_steps?: Json | null
          phone_numbers?: Json | null
          r2_key: string
          red_flags?: Json | null
          scam_type?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string | null
          verdict?: string | null
        }
        Update: {
          channel?: string | null
          confidence?: number | null
          created_at?: string | null
          deepfake_provider?: string | null
          deepfake_raw?: Json | null
          deepfake_raw_v?: number
          deepfake_score?: number | null
          error_message?: string | null
          id?: string
          impersonated_brand?: string | null
          injection_detected?: boolean | null
          job_id?: string
          media_type?: string
          next_steps?: Json | null
          phone_numbers?: Json | null
          r2_key?: string
          red_flags?: Json | null
          scam_type?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      media_analyses_archive: {
        Row: {
          channel: string | null
          confidence: number | null
          created_at: string | null
          deepfake_provider: string | null
          deepfake_raw: Json | null
          deepfake_raw_v: number
          deepfake_score: number | null
          error_message: string | null
          id: string
          impersonated_brand: string | null
          injection_detected: boolean | null
          job_id: string
          media_type: string
          next_steps: Json | null
          phone_numbers: Json | null
          r2_key: string
          red_flags: Json | null
          scam_type: string | null
          status: string
          summary: string | null
          transcript: string | null
          updated_at: string | null
          verdict: string | null
        }
        Insert: {
          channel?: string | null
          confidence?: number | null
          created_at?: string | null
          deepfake_provider?: string | null
          deepfake_raw?: Json | null
          deepfake_raw_v?: number
          deepfake_score?: number | null
          error_message?: string | null
          id?: string
          impersonated_brand?: string | null
          injection_detected?: boolean | null
          job_id: string
          media_type?: string
          next_steps?: Json | null
          phone_numbers?: Json | null
          r2_key: string
          red_flags?: Json | null
          scam_type?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string | null
          verdict?: string | null
        }
        Update: {
          channel?: string | null
          confidence?: number | null
          created_at?: string | null
          deepfake_provider?: string | null
          deepfake_raw?: Json | null
          deepfake_raw_v?: number
          deepfake_score?: number | null
          error_message?: string | null
          id?: string
          impersonated_brand?: string | null
          injection_detected?: boolean | null
          job_id?: string
          media_type?: string
          next_steps?: Json | null
          phone_numbers?: Json | null
          r2_key?: string
          red_flags?: Json | null
          scam_type?: string | null
          status?: string
          summary?: string | null
          transcript?: string | null
          updated_at?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      monitored_brands: {
        Row: {
          aliases: string[]
          brand_name: string
          brand_normalized: string
          created_at: string
          created_by: string | null
          id: number
          is_active: boolean
          legitimate_domains: string[]
          org_id: string
          plan: string | null
          updated_at: string
          verification_method: string | null
          verification_status: string
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          aliases?: string[]
          brand_name: string
          brand_normalized: string
          created_at?: string
          created_by?: string | null
          id?: never
          is_active?: boolean
          legitimate_domains?: string[]
          org_id: string
          plan?: string | null
          updated_at?: string
          verification_method?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          aliases?: string[]
          brand_name?: string
          brand_normalized?: string
          created_at?: string
          created_by?: string | null
          id?: never
          is_active?: boolean
          legitimate_domains?: string[]
          org_id?: string
          plan?: string | null
          updated_at?: string
          verification_method?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      monitored_celebrities: {
        Row: {
          aliases: string[] | null
          brp_enrolled: boolean | null
          contact_email: string | null
          contact_name: string | null
          created_at: string | null
          detection_count: number | null
          facebook_page_id: string | null
          id: number
          last_detected_at: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          aliases?: string[] | null
          brp_enrolled?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          detection_count?: number | null
          facebook_page_id?: string | null
          id?: never
          last_detected_at?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          aliases?: string[] | null
          brp_enrolled?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          detection_count?: number | null
          facebook_page_id?: string | null
          id?: never
          last_detected_at?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      onward_report_log: {
        Row: {
          analysis_id: string | null
          attempts: number
          created_at: string
          delivered_at: string | null
          destination: Database["public"]["Enums"]["onward_destination"]
          destination_key: string | null
          failed_at: string | null
          id: string
          payload_hash: string | null
          provider: string | null
          provider_message_id: string | null
          queued_at: string
          retention_expires_at: string | null
          scam_report_id: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["onward_status"]
          status_reason: string | null
        }
        Insert: {
          analysis_id?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          destination: Database["public"]["Enums"]["onward_destination"]
          destination_key?: string | null
          failed_at?: string | null
          id?: string
          payload_hash?: string | null
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          retention_expires_at?: string | null
          scam_report_id?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["onward_status"]
          status_reason?: string | null
        }
        Update: {
          analysis_id?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          destination?: Database["public"]["Enums"]["onward_destination"]
          destination_key?: string | null
          failed_at?: string | null
          id?: string
          payload_hash?: string | null
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          retention_expires_at?: string | null
          scam_report_id?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["onward_status"]
          status_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onward_report_log_scam_report_id_fkey"
            columns: ["scam_report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: number
          invited_by: string
          org_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: never
          invited_by: string
          org_id: string
          role?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: never
          invited_by?: string
          org_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: number
          invited_by: string | null
          org_id: string
          role: string
          role_title: string | null
          status: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: never
          invited_by?: string | null
          org_id: string
          role?: string
          role_title?: string | null
          status?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: never
          invited_by?: string | null
          org_id?: string
          role?: string
          role_title?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          abn: string | null
          abn_entity_name: string | null
          abn_verified: boolean
          created_at: string
          domain: string | null
          domain_verified: boolean
          fleet_refresh_interval: string | null
          fleet_seat_cap: number | null
          fleet_tier: string | null
          fleet_webhook_secret: string | null
          fleet_webhook_url: string | null
          id: string
          name: string
          sector: string | null
          settings: Json
          slug: string
          status: string
          tier: string
          updated_at: string
        }
        Insert: {
          abn?: string | null
          abn_entity_name?: string | null
          abn_verified?: boolean
          created_at?: string
          domain?: string | null
          domain_verified?: boolean
          fleet_refresh_interval?: string | null
          fleet_seat_cap?: number | null
          fleet_tier?: string | null
          fleet_webhook_secret?: string | null
          fleet_webhook_url?: string | null
          id?: string
          name: string
          sector?: string | null
          settings?: Json
          slug: string
          status?: string
          tier?: string
          updated_at?: string
        }
        Update: {
          abn?: string | null
          abn_entity_name?: string | null
          abn_verified?: boolean
          created_at?: string
          domain?: string | null
          domain_verified?: boolean
          fleet_refresh_interval?: string | null
          fleet_seat_cap?: number | null
          fleet_tier?: string | null
          fleet_webhook_secret?: string | null
          fleet_webhook_url?: string | null
          id?: string
          name?: string
          sector?: string | null
          settings?: Json
          slug?: string
          status?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      pfra_members: {
        Row: {
          abn: string | null
          id: number
          ingested_at: string
          member_type: string
          name: string
          name_normalized: string
          source_url: string
          updated_at: string
        }
        Insert: {
          abn?: string | null
          id?: number
          ingested_at?: string
          member_type: string
          name: string
          name_normalized: string
          source_url: string
          updated_at?: string
        }
        Update: {
          abn?: string | null
          id?: number
          ingested_at?: string
          member_type?: string
          name?: string
          name_normalized?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      phone_footprint_alerts: {
        Row: {
          alert_type: string
          created_at: string
          delivered_at: string | null
          delivered_channels: string[]
          details: Json
          id: number
          idempotency_key: string | null
          monitor_id: number
          next_footprint_id: number
          prev_footprint_id: number | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          delivered_at?: string | null
          delivered_channels?: string[]
          details?: Json
          id?: never
          idempotency_key?: string | null
          monitor_id: number
          next_footprint_id: number
          prev_footprint_id?: number | null
          severity: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          delivered_at?: string | null
          delivered_channels?: string[]
          details?: Json
          id?: never
          idempotency_key?: string | null
          monitor_id?: number
          next_footprint_id?: number
          prev_footprint_id?: number | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_footprint_alerts_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "phone_footprint_monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_footprint_alerts_next_footprint_id_fkey"
            columns: ["next_footprint_id"]
            isOneToOne: false
            referencedRelation: "phone_footprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_footprint_alerts_prev_footprint_id_fkey"
            columns: ["prev_footprint_id"]
            isOneToOne: false
            referencedRelation: "phone_footprints"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_footprint_entitlements: {
        Row: {
          created_at: string
          current_period_end: string | null
          family_head_user_id: string | null
          features: Json
          features_v: number
          id: number
          monthly_lookup_limit: number
          org_id: string | null
          refresh_cadence_min: string
          saved_numbers_limit: number
          sku: string
          status: string
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          family_head_user_id?: string | null
          features?: Json
          features_v?: number
          id?: never
          monthly_lookup_limit?: number
          org_id?: string | null
          refresh_cadence_min?: string
          saved_numbers_limit?: number
          sku: string
          status: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          family_head_user_id?: string | null
          features?: Json
          features_v?: number
          id?: never
          monthly_lookup_limit?: number
          org_id?: string | null
          refresh_cadence_min?: string
          saved_numbers_limit?: number
          sku?: string
          status?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_footprint_entitlements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_footprint_monitors: {
        Row: {
          alert_threshold: number
          alias: string | null
          consent_expires_at: string
          consent_granted_at: string
          created_at: string
          id: number
          last_footprint_id: number | null
          last_refreshed_at: string | null
          msisdn_e164: string
          msisdn_hash: string
          next_refresh_at: string
          org_id: string | null
          ownership_proof: Json | null
          refresh_cadence: string
          scope: string
          soft_deleted_at: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          alert_threshold?: number
          alias?: string | null
          consent_expires_at?: string
          consent_granted_at?: string
          created_at?: string
          id?: never
          last_footprint_id?: number | null
          last_refreshed_at?: string | null
          msisdn_e164: string
          msisdn_hash: string
          next_refresh_at?: string
          org_id?: string | null
          ownership_proof?: Json | null
          refresh_cadence?: string
          scope: string
          soft_deleted_at?: string | null
          status?: string
          tier: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          alert_threshold?: number
          alias?: string | null
          consent_expires_at?: string
          consent_granted_at?: string
          created_at?: string
          id?: never
          last_footprint_id?: number | null
          last_refreshed_at?: string | null
          msisdn_e164?: string
          msisdn_hash?: string
          next_refresh_at?: string
          org_id?: string | null
          ownership_proof?: Json | null
          refresh_cadence?: string
          scope?: string
          soft_deleted_at?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_footprint_monitors_last_footprint_id_fkey"
            columns: ["last_footprint_id"]
            isOneToOne: false
            referencedRelation: "phone_footprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_footprint_monitors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_footprint_otp_attempts: {
        Row: {
          attempted_at: string
          channel: string
          id: number
          ip_hash: string
          msisdn_e164: string
          msisdn_hash: string
          status: string
          twilio_sid: string | null
          user_id: string | null
        }
        Insert: {
          attempted_at?: string
          channel?: string
          id?: never
          ip_hash: string
          msisdn_e164: string
          msisdn_hash: string
          status: string
          twilio_sid?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_at?: string
          channel?: string
          id?: never
          ip_hash?: string
          msisdn_e164?: string
          msisdn_hash?: string
          status?: string
          twilio_sid?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      phone_footprint_refresh_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          id: number
          last_error: string | null
          monitor_id: number
          scheduled_for: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          id?: never
          last_error?: string | null
          monitor_id: number
          scheduled_for: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          id?: never
          last_error?: string | null
          monitor_id?: number
          scheduled_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_footprint_refresh_queue_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: true
            referencedRelation: "phone_footprint_monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_footprints: {
        Row: {
          anonymised_at: string | null
          band: string
          composite_score: number
          coverage: Json
          expires_at: string
          explanation: string | null
          generated_at: string
          id: number
          idempotency_key: string | null
          msisdn_e164: string
          msisdn_hash: string
          org_id: string | null
          pillar_scores: Json
          pillar_scores_v: number
          providers_used: string[]
          request_id: string | null
          tier_generated: string
          user_id: string | null
        }
        Insert: {
          anonymised_at?: string | null
          band: string
          composite_score: number
          coverage?: Json
          expires_at: string
          explanation?: string | null
          generated_at?: string
          id?: never
          idempotency_key?: string | null
          msisdn_e164: string
          msisdn_hash: string
          org_id?: string | null
          pillar_scores?: Json
          pillar_scores_v?: number
          providers_used?: string[]
          request_id?: string | null
          tier_generated: string
          user_id?: string | null
        }
        Update: {
          anonymised_at?: string | null
          band?: string
          composite_score?: number
          coverage?: Json
          expires_at?: string
          explanation?: string | null
          generated_at?: string
          id?: never
          idempotency_key?: string | null
          msisdn_e164?: string
          msisdn_hash?: string
          org_id?: string | null
          pillar_scores?: Json
          pillar_scores_v?: number
          providers_used?: string[]
          request_id?: string | null
          tier_generated?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_footprints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_lookups: {
        Row: {
          analysis_id: string
          caller_name: string | null
          caller_name_type: string | null
          carrier: string | null
          country_code: string | null
          created_at: string | null
          id: string
          is_voip: boolean | null
          line_type: string | null
          phone_number_scrubbed: string
          risk_flags: Json | null
          risk_level: string | null
          risk_score: number | null
        }
        Insert: {
          analysis_id: string
          caller_name?: string | null
          caller_name_type?: string | null
          carrier?: string | null
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_voip?: boolean | null
          line_type?: string | null
          phone_number_scrubbed: string
          risk_flags?: Json | null
          risk_level?: string | null
          risk_score?: number | null
        }
        Update: {
          analysis_id?: string
          caller_name?: string | null
          caller_name_type?: string | null
          carrier?: string | null
          country_code?: string | null
          created_at?: string | null
          id?: string
          is_voip?: boolean | null
          line_type?: string | null
          phone_number_scrubbed?: string
          risk_flags?: Json | null
          risk_level?: string | null
          risk_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_lookups_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "media_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_actions: {
        Row: {
          action_detail: string | null
          action_type: string
          actioned_at: string
          created_at: string
          id: number
          provider_report_id: number
        }
        Insert: {
          action_detail?: string | null
          action_type: string
          actioned_at?: string
          created_at?: string
          id?: never
          provider_report_id: number
        }
        Update: {
          action_detail?: string | null
          action_type?: string
          actioned_at?: string
          created_at?: string
          id?: never
          provider_report_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_actions_provider_report_id_fkey"
            columns: ["provider_report_id"]
            isOneToOne: false
            referencedRelation: "provider_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_reports: {
        Row: {
          acknowledged_at: string | null
          closed_at: string | null
          created_at: string
          entity_id: number
          id: number
          payload: Json
          provider_code: string
          reference_number: string | null
          report_type: string
          response: Json
          status: string
          submitted_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          closed_at?: string | null
          created_at?: string
          entity_id: number
          id?: never
          payload?: Json
          provider_code: string
          reference_number?: string | null
          report_type: string
          response?: Json
          status?: string
          submitted_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          closed_at?: string | null
          created_at?: string
          entity_id?: number
          id?: never
          payload?: Json
          provider_code?: string
          reference_number?: string | null
          report_type?: string
          response?: Json
          status?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_reports_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "scam_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_reports_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "threat_intel_entities"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      reddit_intel_daily_summary: {
        Row: {
          audience: string
          brand_watchlist: Json
          brand_watchlist_v: number
          cohort_date: string
          country_code: string | null
          created_at: string
          emerging_threats: Json
          emerging_threats_v: number
          id: string
          lead_narrative: string
          model_version: string
          posts_classified: number
          prompt_version: string
          stats: Json
        }
        Insert: {
          audience: string
          brand_watchlist?: Json
          brand_watchlist_v?: number
          cohort_date: string
          country_code?: string | null
          created_at?: string
          emerging_threats?: Json
          emerging_threats_v?: number
          id?: string
          lead_narrative: string
          model_version: string
          posts_classified?: number
          prompt_version: string
          stats?: Json
        }
        Update: {
          audience?: string
          brand_watchlist?: Json
          brand_watchlist_v?: number
          cohort_date?: string
          country_code?: string | null
          created_at?: string
          emerging_threats?: Json
          emerging_threats_v?: number
          id?: string
          lead_narrative?: string
          model_version?: string
          posts_classified?: number
          prompt_version?: string
          stats?: Json
        }
        Relationships: []
      }
      reddit_intel_quotes: {
        Row: {
          confidence: number | null
          created_at: string
          feed_item_id: number
          id: string
          intel_id: string
          quote_text: string
          speaker_role: string | null
          theme_tag: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          feed_item_id: number
          id?: string
          intel_id: string
          quote_text: string
          speaker_role?: string | null
          theme_tag?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          feed_item_id?: number
          id?: string
          intel_id?: string
          quote_text?: string
          speaker_role?: string | null
          theme_tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_intel_quotes_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_intel_quotes_intel_id_fkey"
            columns: ["intel_id"]
            isOneToOne: false
            referencedRelation: "reddit_post_intel"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_intel_themes: {
        Row: {
          centroid_embedding: string | null
          centroid_embedding_model_version: string | null
          created_at: string
          first_seen_at: string
          id: string
          ioc_phone_count: number
          ioc_url_count: number
          ioc_wallet_count: number
          is_active: boolean
          last_seen_at: string
          member_count: number
          modus_operandi: string | null
          narrative: string | null
          representative_brands: string[] | null
          signal_strength: string
          slug: string
          title: string
          top_tactic_tags: string[] | null
          updated_at: string
          wow_delta_pct: number | null
        }
        Insert: {
          centroid_embedding?: string | null
          centroid_embedding_model_version?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          ioc_phone_count?: number
          ioc_url_count?: number
          ioc_wallet_count?: number
          is_active?: boolean
          last_seen_at?: string
          member_count?: number
          modus_operandi?: string | null
          narrative?: string | null
          representative_brands?: string[] | null
          signal_strength?: string
          slug: string
          title: string
          top_tactic_tags?: string[] | null
          updated_at?: string
          wow_delta_pct?: number | null
        }
        Update: {
          centroid_embedding?: string | null
          centroid_embedding_model_version?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          ioc_phone_count?: number
          ioc_url_count?: number
          ioc_wallet_count?: number
          is_active?: boolean
          last_seen_at?: string
          member_count?: number
          modus_operandi?: string | null
          narrative?: string | null
          representative_brands?: string[] | null
          signal_strength?: string
          slug?: string
          title?: string
          top_tactic_tags?: string[] | null
          updated_at?: string
          wow_delta_pct?: number | null
        }
        Relationships: []
      }
      reddit_intel_weekly_digest: {
        Row: {
          cohort_post_count: number
          generated_at: string
          model_version: string
          novelty: Json
          prompt_version: string
          scam_of_the_week: Json | null
          stories: Json
          top_brands: Json
          top_categories: Json
          week_end: string
          week_start: string
        }
        Insert: {
          cohort_post_count?: number
          generated_at?: string
          model_version?: string
          novelty?: Json
          prompt_version?: string
          scam_of_the_week?: Json | null
          stories?: Json
          top_brands?: Json
          top_categories?: Json
          week_end: string
          week_start: string
        }
        Update: {
          cohort_post_count?: number
          generated_at?: string
          model_version?: string
          novelty?: Json
          prompt_version?: string
          scam_of_the_week?: Json | null
          stories?: Json
          top_brands?: Json
          top_categories?: Json
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      reddit_post_intel: {
        Row: {
          brands_impersonated: string[] | null
          confidence: number
          country_hints: string[] | null
          embedding: string | null
          embedding_model_version: string | null
          feed_item_id: number
          id: string
          intent_label: string
          model_version: string
          modus_operandi: string | null
          narrative_summary: string | null
          novelty_signals: string[] | null
          processed_at: string
          prompt_version: string
          tactic_tags: string[] | null
          theme_id: string | null
          victim_emotion: string | null
        }
        Insert: {
          brands_impersonated?: string[] | null
          confidence: number
          country_hints?: string[] | null
          embedding?: string | null
          embedding_model_version?: string | null
          feed_item_id: number
          id?: string
          intent_label: string
          model_version: string
          modus_operandi?: string | null
          narrative_summary?: string | null
          novelty_signals?: string[] | null
          processed_at?: string
          prompt_version: string
          tactic_tags?: string[] | null
          theme_id?: string | null
          victim_emotion?: string | null
        }
        Update: {
          brands_impersonated?: string[] | null
          confidence?: number
          country_hints?: string[] | null
          embedding?: string | null
          embedding_model_version?: string | null
          feed_item_id?: number
          id?: string
          intent_label?: string
          model_version?: string
          modus_operandi?: string | null
          narrative_summary?: string | null
          novelty_signals?: string[] | null
          processed_at?: string
          prompt_version?: string
          tactic_tags?: string[] | null
          theme_id?: string | null
          victim_emotion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_post_intel_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: true
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_post_intel_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "reddit_intel_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_post_intel_themes: {
        Row: {
          intel_id: string
          is_primary: boolean
          similarity: number
          theme_id: string
        }
        Insert: {
          intel_id: string
          is_primary?: boolean
          similarity: number
          theme_id: string
        }
        Update: {
          intel_id?: string
          is_primary?: boolean
          similarity?: number
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_post_intel_themes_intel_id_fkey"
            columns: ["intel_id"]
            isOneToOne: false
            referencedRelation: "reddit_post_intel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_post_intel_themes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "reddit_intel_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_processed_posts: {
        Row: {
          post_id: string
          processed_at: string
          subreddit: string
        }
        Insert: {
          post_id: string
          processed_at?: string
          subreddit: string
        }
        Update: {
          post_id?: string
          processed_at?: string
          subreddit?: string
        }
        Relationships: []
      }
      reddit_watchlist_candidates: {
        Row: {
          brand_normalized: string
          created_at: string
          first_seen_at: string
          id: number
          last_seen_at: string
          mention_count: number
          raw_brand: string
          resolved_canonical: string | null
          source: string
          source_counts: Json
          status: string
        }
        Insert: {
          brand_normalized: string
          created_at?: string
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          mention_count?: number
          raw_brand: string
          resolved_canonical?: string | null
          source?: string
          source_counts?: Json
          status?: string
        }
        Update: {
          brand_normalized?: string
          created_at?: string
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          mention_count?: number
          raw_brand?: string
          resolved_canonical?: string | null
          source?: string
          source_counts?: Json
          status?: string
        }
        Relationships: []
      }
      regulator_alert_pushes: {
        Row: {
          error_count: number
          feed_item_id: number
          pushed_at: string
          recipient_count: number
        }
        Insert: {
          error_count?: number
          feed_item_id: number
          pushed_at?: string
          recipient_count?: number
        }
        Update: {
          error_count?: number
          feed_item_id?: number
          pushed_at?: string
          recipient_count?: number
        }
        Relationships: []
      }
      report_entity_links: {
        Row: {
          created_at: string
          entity_id: number
          extraction_method: string
          id: number
          report_id: number
          role: string
        }
        Insert: {
          created_at?: string
          entity_id: number
          extraction_method?: string
          id?: never
          report_id: number
          role?: string
        }
        Update: {
          created_at?: string
          entity_id?: number
          extraction_method?: string
          id?: never
          report_id?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_entity_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "scam_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_entity_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "threat_intel_entities"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "report_entity_links_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_entity_links_archive: {
        Row: {
          archived_at: string
          created_at: string
          entity_id: number
          extraction_method: string
          id: number
          report_id: number
          role: string
        }
        Insert: {
          archived_at?: string
          created_at: string
          entity_id: number
          extraction_method: string
          id: number
          report_id: number
          role: string
        }
        Update: {
          archived_at?: string
          created_at?: string
          entity_id?: number
          extraction_method?: string
          id?: number
          report_id?: number
          role?: string
        }
        Relationships: []
      }
      scam_clusters: {
        Row: {
          cluster_type: string
          created_at: string
          entity_count: number
          first_seen: string
          id: number
          last_seen: string
          member_count: number
          metadata: Json
          primary_brand: string | null
          primary_scam_type: string | null
          status: string
          total_loss: number
        }
        Insert: {
          cluster_type: string
          created_at?: string
          entity_count?: number
          first_seen?: string
          id?: never
          last_seen?: string
          member_count?: number
          metadata?: Json
          primary_brand?: string | null
          primary_scam_type?: string | null
          status?: string
          total_loss?: number
        }
        Update: {
          cluster_type?: string
          created_at?: string
          entity_count?: number
          first_seen?: string
          id?: never
          last_seen?: string
          member_count?: number
          metadata?: Json
          primary_brand?: string | null
          primary_scam_type?: string | null
          status?: string
          total_loss?: number
        }
        Relationships: []
      }
      scam_crypto_wallets: {
        Row: {
          address: string
          associated_domain: string | null
          associated_url: string | null
          chain: string
          confidence_level: string | null
          confidence_score: number | null
          country_code: string | null
          created_at: string | null
          feed_references: Json | null
          feed_reported_at: string | null
          feed_sources: string[] | null
          id: number
          is_active: boolean | null
          last_seen_in_feed: string | null
          scam_type: string | null
          staleness_checked_at: string | null
        }
        Insert: {
          address: string
          associated_domain?: string | null
          associated_url?: string | null
          chain: string
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          created_at?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          id?: never
          is_active?: boolean | null
          last_seen_in_feed?: string | null
          scam_type?: string | null
          staleness_checked_at?: string | null
        }
        Update: {
          address?: string
          associated_domain?: string | null
          associated_url?: string | null
          chain?: string
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          created_at?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          id?: never
          is_active?: boolean | null
          last_seen_in_feed?: string | null
          scam_type?: string | null
          staleness_checked_at?: string | null
        }
        Relationships: []
      }
      scam_entities: {
        Row: {
          canonical_entity_id: number | null
          canonical_entity_table: string | null
          consent_basis: string | null
          country_code: string | null
          created_at: string
          enriched_at: string | null
          enrichment_data: Json
          enrichment_error: string | null
          enrichment_status: string
          entity_type: string
          evidence_r2_key: string | null
          feed_references: Json | null
          feed_reported_at: string | null
          feed_sources: string[] | null
          first_seen: string
          id: number
          investigated_at: string | null
          investigation_data: Json | null
          last_seen: string
          last_seen_in_feed: string | null
          legal_basis: string
          normalized_value: string
          provenance_tier:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          raw_value: string | null
          report_count: number
          risk_factors: Json
          risk_level: string | null
          risk_score: number | null
          risk_scored_at: string | null
        }
        Insert: {
          canonical_entity_id?: number | null
          canonical_entity_table?: string | null
          consent_basis?: string | null
          country_code?: string | null
          created_at?: string
          enriched_at?: string | null
          enrichment_data?: Json
          enrichment_error?: string | null
          enrichment_status?: string
          entity_type: string
          evidence_r2_key?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_seen?: string
          id?: never
          investigated_at?: string | null
          investigation_data?: Json | null
          last_seen?: string
          last_seen_in_feed?: string | null
          legal_basis?: string
          normalized_value: string
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          raw_value?: string | null
          report_count?: number
          risk_factors?: Json
          risk_level?: string | null
          risk_score?: number | null
          risk_scored_at?: string | null
        }
        Update: {
          canonical_entity_id?: number | null
          canonical_entity_table?: string | null
          consent_basis?: string | null
          country_code?: string | null
          created_at?: string
          enriched_at?: string | null
          enrichment_data?: Json
          enrichment_error?: string | null
          enrichment_status?: string
          entity_type?: string
          evidence_r2_key?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_seen?: string
          id?: never
          investigated_at?: string | null
          investigation_data?: Json | null
          last_seen?: string
          last_seen_in_feed?: string | null
          legal_basis?: string
          normalized_value?: string
          provenance_tier?:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          raw_value?: string | null
          report_count?: number
          risk_factors?: Json
          risk_level?: string | null
          risk_score?: number | null
          risk_scored_at?: string | null
        }
        Relationships: []
      }
      scam_ips: {
        Row: {
          as_name: string | null
          as_number: number | null
          blocklist_count: number | null
          confidence_level: string | null
          confidence_score: number | null
          country: string | null
          created_at: string | null
          feed_references: Json | null
          feed_reported_at: string | null
          feed_sources: string[] | null
          first_seen: string | null
          id: number
          ip_address: unknown
          ip_version: number | null
          is_active: boolean | null
          last_online: string | null
          last_seen_in_feed: string | null
          port: number | null
          staleness_checked_at: string | null
          threat_type: string | null
        }
        Insert: {
          as_name?: string | null
          as_number?: number | null
          blocklist_count?: number | null
          confidence_level?: string | null
          confidence_score?: number | null
          country?: string | null
          created_at?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_seen?: string | null
          id?: never
          ip_address: unknown
          ip_version?: number | null
          is_active?: boolean | null
          last_online?: string | null
          last_seen_in_feed?: string | null
          port?: number | null
          staleness_checked_at?: string | null
          threat_type?: string | null
        }
        Update: {
          as_name?: string | null
          as_number?: number | null
          blocklist_count?: number | null
          confidence_level?: string | null
          confidence_score?: number | null
          country?: string | null
          created_at?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_seen?: string | null
          id?: never
          ip_address?: unknown
          ip_version?: number | null
          is_active?: boolean | null
          last_online?: string | null
          last_seen_in_feed?: string | null
          port?: number | null
          staleness_checked_at?: string | null
          threat_type?: string | null
        }
        Relationships: []
      }
      scam_reports: {
        Row: {
          analysis_result: Json
          analysis_result_v: number
          body_tsv: unknown
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          embedding: string | null
          embedding_model_version: string | null
          estimated_loss: number | null
          id: number
          idempotency_key: string | null
          impersonated_brand: string | null
          input_mode: string | null
          loss_currency: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          target_country: string | null
          target_region: string | null
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          analysis_result_v?: number
          body_tsv?: unknown
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          embedding?: string | null
          embedding_model_version?: string | null
          estimated_loss?: number | null
          id?: never
          idempotency_key?: string | null
          impersonated_brand?: string | null
          input_mode?: string | null
          loss_currency?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          target_country?: string | null
          target_region?: string | null
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          analysis_result_v?: number
          body_tsv?: unknown
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          embedding?: string | null
          embedding_model_version?: string | null
          estimated_loss?: number | null
          id?: never
          idempotency_key?: string | null
          impersonated_brand?: string | null
          input_mode?: string | null
          loss_currency?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          target_country?: string | null
          target_region?: string | null
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_scam_reports_cluster"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "scam_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_scam_reports_cluster"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "threat_intel_scam_campaigns"
            referencedColumns: ["cluster_id"]
          },
          {
            foreignKeyName: "scam_reports_verified_scam_id_fkey"
            columns: ["verified_scam_id"]
            isOneToOne: false
            referencedRelation: "verified_scams"
            referencedColumns: ["id"]
          },
        ]
      }
      scam_reports_archive: {
        Row: {
          analysis_result: Json
          archived_at: string
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          archived_at?: string
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at: string
          delivery_method?: string | null
          id: number
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          archived_at?: string
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: number
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m01: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m02: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m03: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m04: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m05: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_reports_partitioned_y2026m06: {
        Row: {
          analysis_result: Json
          channel: string | null
          cluster_id: number | null
          confidence_score: number
          country_code: string | null
          created_at: string
          delivery_method: string | null
          id: number
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string
          scam_type: string | null
          scrubbed_content: string | null
          source: string
          verdict: string
          verified_scam_id: number | null
        }
        Insert: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source: string
          verdict: string
          verified_scam_id?: number | null
        }
        Update: {
          analysis_result?: Json
          channel?: string | null
          cluster_id?: number | null
          confidence_score?: number
          country_code?: string | null
          created_at?: string
          delivery_method?: string | null
          id?: never
          impersonated_brand?: string | null
          input_mode?: string | null
          region?: string | null
          reporter_hash?: string
          scam_type?: string | null
          scrubbed_content?: string | null
          source?: string
          verdict?: string
          verified_scam_id?: number | null
        }
        Relationships: []
      }
      scam_urls: {
        Row: {
          brand_impersonated: string | null
          confidence_level: string | null
          confidence_score: number | null
          country_code: string | null
          created_at: string | null
          domain: string
          enrichment_attempted_at: string | null
          enrichment_status: string | null
          feed_references: Json | null
          feed_reported_at: string | null
          feed_sources: string[] | null
          first_reported_at: string | null
          full_path: string | null
          google_safe_browsing: boolean | null
          id: number
          is_active: boolean | null
          last_reported_at: string | null
          last_seen_in_feed: string | null
          normalized_url: string
          primary_scam_type: string | null
          report_count: number | null
          source_type: string | null
          ssl_days_remaining: number | null
          ssl_issuer: string | null
          ssl_valid: boolean | null
          staleness_checked_at: string | null
          subdomain: string | null
          tld: string
          unique_reporter_count: number | null
          virustotal_malicious: number | null
          virustotal_score: string | null
          whois_created_date: string | null
          whois_expires_date: string | null
          whois_is_private: boolean | null
          whois_lookup_at: string | null
          whois_name_servers: string[] | null
          whois_raw: Json | null
          whois_registrant_country: string | null
          whois_registrar: string | null
        }
        Insert: {
          brand_impersonated?: string | null
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          created_at?: string | null
          domain: string
          enrichment_attempted_at?: string | null
          enrichment_status?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_reported_at?: string | null
          full_path?: string | null
          google_safe_browsing?: boolean | null
          id?: never
          is_active?: boolean | null
          last_reported_at?: string | null
          last_seen_in_feed?: string | null
          normalized_url: string
          primary_scam_type?: string | null
          report_count?: number | null
          source_type?: string | null
          ssl_days_remaining?: number | null
          ssl_issuer?: string | null
          ssl_valid?: boolean | null
          staleness_checked_at?: string | null
          subdomain?: string | null
          tld: string
          unique_reporter_count?: number | null
          virustotal_malicious?: number | null
          virustotal_score?: string | null
          whois_created_date?: string | null
          whois_expires_date?: string | null
          whois_is_private?: boolean | null
          whois_lookup_at?: string | null
          whois_name_servers?: string[] | null
          whois_raw?: Json | null
          whois_registrant_country?: string | null
          whois_registrar?: string | null
        }
        Update: {
          brand_impersonated?: string | null
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          created_at?: string | null
          domain?: string
          enrichment_attempted_at?: string | null
          enrichment_status?: string | null
          feed_references?: Json | null
          feed_reported_at?: string | null
          feed_sources?: string[] | null
          first_reported_at?: string | null
          full_path?: string | null
          google_safe_browsing?: boolean | null
          id?: never
          is_active?: boolean | null
          last_reported_at?: string | null
          last_seen_in_feed?: string | null
          normalized_url?: string
          primary_scam_type?: string | null
          report_count?: number | null
          source_type?: string | null
          ssl_days_remaining?: number | null
          ssl_issuer?: string | null
          ssl_valid?: boolean | null
          staleness_checked_at?: string | null
          subdomain?: string | null
          tld?: string
          unique_reporter_count?: number | null
          virustotal_malicious?: number | null
          virustotal_score?: string | null
          whois_created_date?: string | null
          whois_expires_date?: string | null
          whois_is_private?: boolean | null
          whois_lookup_at?: string | null
          whois_name_servers?: string[] | null
          whois_raw?: Json | null
          whois_registrant_country?: string | null
          whois_registrar?: string | null
        }
        Relationships: []
      }
      scan_results: {
        Row: {
          grade: string
          id: number
          overall_score: number
          result: Json
          scan_type: string
          scanned_at: string
          share_token: string
          target: string
          target_display: string | null
          visibility: string
        }
        Insert: {
          grade?: string
          id?: number
          overall_score?: number
          result?: Json
          scan_type: string
          scanned_at?: string
          share_token?: string
          target: string
          target_display?: string | null
          visibility?: string
        }
        Update: {
          grade?: string
          id?: number
          overall_score?: number
          result?: Json
          scan_type?: string
          scanned_at?: string
          share_token?: string
          target?: string
          target_display?: string | null
          visibility?: string
        }
        Relationships: []
      }
      scan_results_archive: {
        Row: {
          grade: string
          id: number
          overall_score: number
          result: Json
          scan_type: string
          scanned_at: string
          share_token: string
          target: string
          target_display: string | null
          visibility: string
        }
        Insert: {
          grade?: string
          id?: number
          overall_score?: number
          result?: Json
          scan_type: string
          scanned_at?: string
          share_token?: string
          target: string
          target_display?: string | null
          visibility?: string
        }
        Update: {
          grade?: string
          id?: number
          overall_score?: number
          result?: Json
          scan_type?: string
          scanned_at?: string
          share_token?: string
          target?: string
          target_display?: string | null
          visibility?: string
        }
        Relationships: []
      }
      shop_checks: {
        Row: {
          composite_score: number
          evaluated_at: string
          id: string
          idempotency_key: string | null
          referrer_source: string | null
          request_id: string | null
          signal: Json
          source_surface: string | null
          ttl_expires_at: string
          url_hash: string
          url_normalized: string
          verdict: string
        }
        Insert: {
          composite_score: number
          evaluated_at?: string
          id?: string
          idempotency_key?: string | null
          referrer_source?: string | null
          request_id?: string | null
          signal: Json
          source_surface?: string | null
          ttl_expires_at?: string
          url_hash: string
          url_normalized: string
          verdict: string
        }
        Update: {
          composite_score?: number
          evaluated_at?: string
          id?: string
          idempotency_key?: string | null
          referrer_source?: string | null
          request_id?: string | null
          signal?: Json
          source_surface?: string | null
          ttl_expires_at?: string
          url_hash?: string
          url_normalized?: string
          verdict?: string
        }
        Relationships: []
      }
      shop_review_findings: {
        Row: {
          average_rating: number | null
          check_count: number
          composite_score: number | null
          distribution: Json | null
          domain: string
          fake_likelihood: number | null
          first_flagged_at: string
          last_checked_at: string
          latest_verdict: string
          reasons: Json
          review_app: string
          sample_url: string | null
          total_reviews: number | null
          worst_verdict: string
        }
        Insert: {
          average_rating?: number | null
          check_count?: number
          composite_score?: number | null
          distribution?: Json | null
          domain: string
          fake_likelihood?: number | null
          first_flagged_at?: string
          last_checked_at?: string
          latest_verdict: string
          reasons?: Json
          review_app: string
          sample_url?: string | null
          total_reviews?: number | null
          worst_verdict: string
        }
        Update: {
          average_rating?: number | null
          check_count?: number
          composite_score?: number | null
          distribution?: Json | null
          domain?: string
          fake_likelihood?: number | null
          first_flagged_at?: string
          last_checked_at?: string
          latest_verdict?: string
          reasons?: Json
          review_app?: string
          sample_url?: string | null
          total_reviews?: number | null
          worst_verdict?: string
        }
        Relationships: []
      }
      shopfront_clone_alerts: {
        Row: {
          alert_state: string
          attribution: Json | null
          candidate_domain: string
          candidate_url: string
          created_at: string
          evidence: Json
          fetch_status: string | null
          first_seen_at: string
          id: number
          inferred_target_domain: string | null
          last_fetched_at: string | null
          last_rechecked_at: string | null
          last_seen_at: string
          lifecycle_state: string
          netcraft_declined_at: string | null
          recheck_count: number
          severity: number
          severity_tier: string
          signals: Json
          source: string
          submitted_to: Json
          target_brand_normalized: string | null
          target_shop_id: number | null
          triage_at: string | null
          triage_by: string | null
          triage_notes: string | null
          triage_status: string | null
          updated_at: string
          url_hash: string
          urlscan_classification: string | null
          urlscan_evidence: Json | null
          urlscan_failure_streak: number
          urlscan_scanned_at: string | null
          urlscan_submitted_at: string | null
          urlscan_uuid: string | null
          weaponised_at: string | null
        }
        Insert: {
          alert_state?: string
          attribution?: Json | null
          candidate_domain: string
          candidate_url: string
          created_at?: string
          evidence?: Json
          fetch_status?: string | null
          first_seen_at?: string
          id?: number
          inferred_target_domain?: string | null
          last_fetched_at?: string | null
          last_rechecked_at?: string | null
          last_seen_at?: string
          lifecycle_state?: string
          netcraft_declined_at?: string | null
          recheck_count?: number
          severity: number
          severity_tier: string
          signals?: Json
          source: string
          submitted_to?: Json
          target_brand_normalized?: string | null
          target_shop_id?: number | null
          triage_at?: string | null
          triage_by?: string | null
          triage_notes?: string | null
          triage_status?: string | null
          updated_at?: string
          url_hash: string
          urlscan_classification?: string | null
          urlscan_evidence?: Json | null
          urlscan_failure_streak?: number
          urlscan_scanned_at?: string | null
          urlscan_submitted_at?: string | null
          urlscan_uuid?: string | null
          weaponised_at?: string | null
        }
        Update: {
          alert_state?: string
          attribution?: Json | null
          candidate_domain?: string
          candidate_url?: string
          created_at?: string
          evidence?: Json
          fetch_status?: string | null
          first_seen_at?: string
          id?: number
          inferred_target_domain?: string | null
          last_fetched_at?: string | null
          last_rechecked_at?: string | null
          last_seen_at?: string
          lifecycle_state?: string
          netcraft_declined_at?: string | null
          recheck_count?: number
          severity?: number
          severity_tier?: string
          signals?: Json
          source?: string
          submitted_to?: Json
          target_brand_normalized?: string | null
          target_shop_id?: number | null
          triage_at?: string | null
          triage_by?: string | null
          triage_notes?: string | null
          triage_status?: string | null
          updated_at?: string
          url_hash?: string
          urlscan_classification?: string | null
          urlscan_evidence?: Json | null
          urlscan_failure_streak?: number
          urlscan_scanned_at?: string | null
          urlscan_submitted_at?: string | null
          urlscan_uuid?: string | null
          weaponised_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopfront_clone_alerts_target_shop_id_fkey"
            columns: ["target_shop_id"]
            isOneToOne: false
            referencedRelation: "shopfront_shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shopfront_shops: {
        Row: {
          created_at: string
          id: number
          installed_at: string
          shop_domain: string
          shopify_shop_id: string | null
          uninstalled_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          installed_at?: string
          shop_domain: string
          shopify_shop_id?: string | null
          uninstalled_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          installed_at?: string
          shop_domain?: string
          shopify_shop_id?: string | null
          uninstalled_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shopfront_takedown_attempts: {
        Row: {
          acts_on_parked: boolean
          approved_at: string | null
          approved_by_user_id: string | null
          attempt_type: string
          body_md: string | null
          case_status: string
          channel_autonomy: string
          clone_alert_id: number
          created_at: string
          drafted_at: string
          evidence_bundle: Json
          external_ref: string | null
          id: number
          initiated_by: string
          initiated_by_user_id: string | null
          last_reemergence_check_at: string | null
          next_action_at: string | null
          outcome: string | null
          outcome_notes: string | null
          recipient_email: string | null
          recipient_org: string | null
          response_at: string | null
          sent_at: string | null
          submitted_at: string | null
          template_version: string | null
          updated_at: string
          verification_checklist: Json | null
        }
        Insert: {
          acts_on_parked?: boolean
          approved_at?: string | null
          approved_by_user_id?: string | null
          attempt_type: string
          body_md?: string | null
          case_status?: string
          channel_autonomy?: string
          clone_alert_id: number
          created_at?: string
          drafted_at?: string
          evidence_bundle?: Json
          external_ref?: string | null
          id?: number
          initiated_by: string
          initiated_by_user_id?: string | null
          last_reemergence_check_at?: string | null
          next_action_at?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          recipient_email?: string | null
          recipient_org?: string | null
          response_at?: string | null
          sent_at?: string | null
          submitted_at?: string | null
          template_version?: string | null
          updated_at?: string
          verification_checklist?: Json | null
        }
        Update: {
          acts_on_parked?: boolean
          approved_at?: string | null
          approved_by_user_id?: string | null
          attempt_type?: string
          body_md?: string | null
          case_status?: string
          channel_autonomy?: string
          clone_alert_id?: number
          created_at?: string
          drafted_at?: string
          evidence_bundle?: Json
          external_ref?: string | null
          id?: number
          initiated_by?: string
          initiated_by_user_id?: string | null
          last_reemergence_check_at?: string | null
          next_action_at?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          recipient_email?: string | null
          recipient_org?: string | null
          response_at?: string | null
          sent_at?: string | null
          submitted_at?: string | null
          template_version?: string | null
          updated_at?: string
          verification_checklist?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "shopfront_takedown_attempts_clone_alert_id_fkey"
            columns: ["clone_alert_id"]
            isOneToOne: false
            referencedRelation: "shopfront_clone_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_swap_beta_invites: {
        Row: {
          created_at: string
          created_by: string
          email: string | null
          invite_code: string
          redeemed_at: string | null
          redeemed_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          email?: string | null
          invite_code: string
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string | null
          invite_code?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: []
      }
      sim_swap_credit_ledger: {
        Row: {
          bucket: string
          created_at: string
          delta: number
          id: number
          reason: string
          stripe_ref: string | null
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          delta: number
          id?: never
          reason: string
          stripe_ref?: string | null
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          delta?: number
          id?: never
          reason?: string
          stripe_ref?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sim_swap_credits: {
        Row: {
          free_remaining: number
          paid_remaining: number
          period_start: string
          recovery_remaining: number
          updated_at: string
          user_id: string
        }
        Insert: {
          free_remaining?: number
          paid_remaining?: number
          period_start?: string
          recovery_remaining?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          free_remaining?: number
          paid_remaining?: number
          period_start?: string
          recovery_remaining?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sim_swap_events: {
        Row: {
          cost_usd: number | null
          created_at: string
          id: number
          latency_ms: number | null
          max_age_checked: number | null
          monitor_id: number | null
          msisdn_e164: string
          msisdn_hash: string
          raw_response: Json
          source: string
          swap_date: string | null
          swapped: boolean
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          max_age_checked?: number | null
          monitor_id?: number | null
          msisdn_e164: string
          msisdn_hash: string
          raw_response?: Json
          source: string
          swap_date?: string | null
          swapped: boolean
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          max_age_checked?: number | null
          monitor_id?: number | null
          msisdn_e164?: string
          msisdn_hash?: string
          raw_response?: Json
          source?: string
          swap_date?: string | null
          swapped?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sim_swap_events_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "sim_swap_monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_swap_monitors: {
        Row: {
          active: boolean
          created_at: string
          id: number
          last_check_at: string | null
          max_age_hours: number
          msisdn_e164: string
          msisdn_hash: string
          org_id: string | null
          provider: string
          soft_deleted_at: string | null
          updated_at: string
          user_id: string | null
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          last_check_at?: string | null
          max_age_hours?: number
          msisdn_e164: string
          msisdn_hash: string
          org_id?: string | null
          provider?: string
          soft_deleted_at?: string | null
          updated_at?: string
          user_id?: string | null
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          last_check_at?: string | null
          max_age_hours?: number
          msisdn_e164?: string
          msisdn_hash?: string
          org_id?: string | null
          provider?: string
          soft_deleted_at?: string | null
          updated_at?: string
          user_id?: string | null
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sim_swap_monitors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audits: {
        Row: {
          category_scores: Json
          duration_ms: number | null
          fetch_error: Json | null
          grade: string
          id: number
          overall_score: number
          partial: boolean
          raw_headers: Json | null
          recommendations: string[] | null
          recommendations_v2: Json | null
          scanned_at: string
          share_token: string | null
          site_id: number
          test_results: Json
        }
        Insert: {
          category_scores?: Json
          duration_ms?: number | null
          fetch_error?: Json | null
          grade: string
          id?: never
          overall_score: number
          partial?: boolean
          raw_headers?: Json | null
          recommendations?: string[] | null
          recommendations_v2?: Json | null
          scanned_at?: string
          share_token?: string | null
          site_id: number
          test_results?: Json
        }
        Update: {
          category_scores?: Json
          duration_ms?: number | null
          fetch_error?: Json | null
          grade?: string
          id?: never
          overall_score?: number
          partial?: boolean
          raw_headers?: Json | null
          recommendations?: string[] | null
          recommendations_v2?: Json | null
          scanned_at?: string
          share_token?: string | null
          site_id?: number
          test_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "site_audits_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          badge_eligible: boolean
          badge_token: string | null
          domain: string
          first_scanned_at: string
          id: number
          last_scanned_at: string
          latest_grade: string | null
          latest_score: number | null
          normalized_url: string
          scan_count: number
        }
        Insert: {
          badge_eligible?: boolean
          badge_token?: string | null
          domain: string
          first_scanned_at?: string
          id?: never
          last_scanned_at?: string
          latest_grade?: string | null
          latest_score?: number | null
          normalized_url: string
          scan_count?: number
        }
        Update: {
          badge_eligible?: boolean
          badge_token?: string | null
          domain?: string
          first_scanned_at?: string
          id?: never
          last_scanned_at?: string
          latest_grade?: string | null
          latest_score?: number | null
          normalized_url?: string
          scan_count?: number
        }
        Relationships: []
      }
      stripe_event_log: {
        Row: {
          api_version: string | null
          event_id: string
          event_type: string
          processed_at: string | null
          received_at: string
        }
        Insert: {
          api_version?: string | null
          event_id: string
          event_type: string
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          api_version?: string | null
          event_id?: string
          event_type?: string
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      subscriber_match_checks: {
        Row: {
          confidence: number | null
          cost_usd: number | null
          created_at: string
          id: number
          latency_ms: number | null
          match_result: string
          msisdn_e164: string
          msisdn_hash: string
          raw_response: Json
          requested_name_hash: string
          source: string
        }
        Insert: {
          confidence?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          match_result: string
          msisdn_e164: string
          msisdn_hash: string
          raw_response?: Json
          requested_name_hash: string
          source: string
        }
        Update: {
          confidence?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: never
          latency_ms?: number | null
          match_result?: string
          msisdn_e164?: string
          msisdn_hash?: string
          raw_response?: Json
          requested_name_hash?: string
          source?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          api_key_id: number
          billing_email: string | null
          billing_provider: string
          cancel_at: string | null
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: number
          metadata: Json
          metadata_v: number
          paddle_customer_id: string | null
          paddle_price_id: string | null
          paddle_subscription_id: string | null
          paused_at: string | null
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          api_key_id: number
          billing_email?: string | null
          billing_provider?: string
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: never
          metadata?: Json
          metadata_v?: number
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_subscription_id?: string | null
          paused_at?: string | null
          plan: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          api_key_id?: number
          billing_email?: string | null
          billing_provider?: string
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: never
          metadata?: Json
          metadata_v?: number
          paddle_customer_id?: string | null
          paddle_price_id?: string | null
          paddle_subscription_id?: string | null
          paused_at?: string | null
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      telco_api_usage: {
        Row: {
          cost_aud: number | null
          cost_usd: number | null
          created_at: string
          endpoint: string
          id: number
          latency_ms: number | null
          metadata: Json
          msisdn_hash: string | null
          org_id: string | null
          provider: string
          status: string
          user_id: string | null
        }
        Insert: {
          cost_aud?: number | null
          cost_usd?: number | null
          created_at?: string
          endpoint: string
          id?: never
          latency_ms?: number | null
          metadata?: Json
          msisdn_hash?: string | null
          org_id?: string | null
          provider: string
          status: string
          user_id?: string | null
        }
        Update: {
          cost_aud?: number | null
          cost_usd?: number | null
          created_at?: string
          endpoint?: string
          id?: never
          latency_ms?: number | null
          metadata?: Json
          msisdn_hash?: string | null
          org_id?: string | null
          provider?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telco_api_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telco_provider_health: {
        Row: {
          endpoint: string
          id: number
          mode: string
          observed_at: string
          p95_latency_ms: number | null
          provider: string
          sample_count_5m: number | null
          success_rate_5m: number | null
        }
        Insert: {
          endpoint: string
          id?: never
          mode: string
          observed_at?: string
          p95_latency_ms?: number | null
          provider: string
          sample_count_5m?: number | null
          success_rate_5m?: number | null
        }
        Update: {
          endpoint?: string
          id?: never
          mode?: string
          observed_at?: string
          p95_latency_ms?: number | null
          provider?: string
          sample_count_5m?: number | null
          success_rate_5m?: number | null
        }
        Relationships: []
      }
      telco_signal_history: {
        Row: {
          entity_id: number
          id: number
          observed_at: string
          severity: number | null
          signal_type: string
          signal_value: Json
          source: string
        }
        Insert: {
          entity_id: number
          id?: never
          observed_at?: string
          severity?: number | null
          signal_type: string
          signal_value: Json
          source: string
        }
        Update: {
          entity_id?: number
          id?: never
          observed_at?: string
          severity?: number | null
          signal_type?: string
          signal_value?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "telco_signal_history_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "scam_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telco_signal_history_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "threat_intel_entities"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      telco_webhook_subscriptions: {
        Row: {
          created_at: string
          event_type: string
          id: number
          last_heartbeat_at: string | null
          monitor_id: number | null
          org_id: string | null
          provider: string
          status: string
          subscription_id_external: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          last_heartbeat_at?: string | null
          monitor_id?: number | null
          org_id?: string | null
          provider: string
          status?: string
          subscription_id_external?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          last_heartbeat_at?: string | null
          monitor_id?: number | null
          org_id?: string | null
          provider?: string
          status?: string
          subscription_id_external?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telco_webhook_subscriptions_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "sim_swap_monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telco_webhook_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          billing_email: string | null
          company_name: string | null
          created_at: string
          display_name: string | null
          id: string
          phone_e164: string | null
          phone_e164_hash: string | null
          phone_verified_at: string | null
          role: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          company_name?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          phone_e164?: string | null
          phone_e164_hash?: string | null
          phone_verified_at?: string | null
          role?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          company_name?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone_e164?: string | null
          phone_e164_hash?: string | null
          phone_verified_at?: string | null
          role?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      verdict_feedback: {
        Row: {
          analysis_id: string | null
          comment: string | null
          created_at: string
          followup_email: string | null
          id: number
          locale: string | null
          reason_codes: string[] | null
          reporter_hash: string
          scam_report_id: number | null
          submitted_content_hash: string | null
          training_consent: boolean | null
          user_agent_family: string | null
          user_says: string
          verdict_given: string
          wants_followup: boolean | null
        }
        Insert: {
          analysis_id?: string | null
          comment?: string | null
          created_at?: string
          followup_email?: string | null
          id?: number
          locale?: string | null
          reason_codes?: string[] | null
          reporter_hash: string
          scam_report_id?: number | null
          submitted_content_hash?: string | null
          training_consent?: boolean | null
          user_agent_family?: string | null
          user_says: string
          verdict_given: string
          wants_followup?: boolean | null
        }
        Update: {
          analysis_id?: string | null
          comment?: string | null
          created_at?: string
          followup_email?: string | null
          id?: number
          locale?: string | null
          reason_codes?: string[] | null
          reporter_hash?: string
          scam_report_id?: number | null
          submitted_content_hash?: string | null
          training_consent?: boolean | null
          user_agent_family?: string | null
          user_says?: string
          verdict_given?: string
          wants_followup?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "verdict_feedback_scam_report_id_fkey"
            columns: ["scam_report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      verdict_feedback_archive: {
        Row: {
          analysis_id: string | null
          comment: string | null
          created_at: string
          followup_email: string | null
          id: number
          locale: string | null
          reason_codes: string[] | null
          reporter_hash: string
          scam_report_id: number | null
          submitted_content_hash: string | null
          training_consent: boolean | null
          user_agent_family: string | null
          user_says: string
          verdict_given: string
          wants_followup: boolean | null
        }
        Insert: {
          analysis_id?: string | null
          comment?: string | null
          created_at?: string
          followup_email?: string | null
          id?: number
          locale?: string | null
          reason_codes?: string[] | null
          reporter_hash: string
          scam_report_id?: number | null
          submitted_content_hash?: string | null
          training_consent?: boolean | null
          user_agent_family?: string | null
          user_says: string
          verdict_given: string
          wants_followup?: boolean | null
        }
        Update: {
          analysis_id?: string | null
          comment?: string | null
          created_at?: string
          followup_email?: string | null
          id?: number
          locale?: string | null
          reason_codes?: string[] | null
          reporter_hash?: string
          scam_report_id?: number | null
          submitted_content_hash?: string | null
          training_consent?: boolean | null
          user_agent_family?: string | null
          user_says?: string
          verdict_given?: string
          wants_followup?: boolean | null
        }
        Relationships: []
      }
      verified_scams: {
        Row: {
          channel: string | null
          confidence_score: number | null
          created_at: string
          embedding: string | null
          embedding_model_version: string | null
          id: number
          impersonated_brand: string | null
          red_flags: Json
          region: string | null
          scam_type: string
          screenshot_key: string | null
          summary: string
        }
        Insert: {
          channel?: string | null
          confidence_score?: number | null
          created_at?: string
          embedding?: string | null
          embedding_model_version?: string | null
          id?: never
          impersonated_brand?: string | null
          red_flags?: Json
          region?: string | null
          scam_type: string
          screenshot_key?: string | null
          summary: string
        }
        Update: {
          channel?: string | null
          confidence_score?: number | null
          created_at?: string
          embedding?: string | null
          embedding_model_version?: string | null
          id?: never
          impersonated_brand?: string | null
          red_flags?: Json
          region?: string | null
          scam_type?: string
          screenshot_key?: string | null
          summary?: string
        }
        Relationships: []
      }
      visitors: {
        Row: {
          anonymous_id: string
          first_referrer: string | null
          first_referring_domain: string | null
          first_seen_at: string
          first_utm_campaign: string | null
          first_utm_content: string | null
          first_utm_medium: string | null
          first_utm_source: string | null
          first_utm_term: string | null
          landing_path: string | null
        }
        Insert: {
          anonymous_id: string
          first_referrer?: string | null
          first_referring_domain?: string | null
          first_seen_at?: string
          first_utm_campaign?: string | null
          first_utm_content?: string | null
          first_utm_medium?: string | null
          first_utm_source?: string | null
          first_utm_term?: string | null
          landing_path?: string | null
        }
        Update: {
          anonymous_id?: string
          first_referrer?: string | null
          first_referring_domain?: string | null
          first_seen_at?: string
          first_utm_campaign?: string | null
          first_utm_content?: string | null
          first_utm_medium?: string | null
          first_utm_source?: string | null
          first_utm_term?: string | null
          landing_path?: string | null
        }
        Relationships: []
      }
      vulnerabilities: {
        Row: {
          affected_products: Json
          affected_versions: Json
          au_context: Json
          category: string
          cisa_kev: boolean
          cisa_kev_added_at: string | null
          cvss_score: number | null
          cvss_vector: string | null
          enriched_at: string | null
          enrichment_version: number
          epss_percentile: number | null
          epss_score: number | null
          exploit_available: boolean
          exploited_in_wild: boolean
          external_references: Json
          id: number
          identifier: string
          identifier_type: string
          ingested_at: string
          is_stub: boolean
          last_modified_at: string | null
          lifecycle_status: string
          patched_in_versions: Json
          published_at: string | null
          severity: string | null
          source_feeds: string[] | null
          subcategory: string | null
          summary: string | null
          tags: string[] | null
          title: string
        }
        Insert: {
          affected_products?: Json
          affected_versions?: Json
          au_context?: Json
          category: string
          cisa_kev?: boolean
          cisa_kev_added_at?: string | null
          cvss_score?: number | null
          cvss_vector?: string | null
          enriched_at?: string | null
          enrichment_version?: number
          epss_percentile?: number | null
          epss_score?: number | null
          exploit_available?: boolean
          exploited_in_wild?: boolean
          external_references?: Json
          id?: never
          identifier: string
          identifier_type: string
          ingested_at?: string
          is_stub?: boolean
          last_modified_at?: string | null
          lifecycle_status?: string
          patched_in_versions?: Json
          published_at?: string | null
          severity?: string | null
          source_feeds?: string[] | null
          subcategory?: string | null
          summary?: string | null
          tags?: string[] | null
          title: string
        }
        Update: {
          affected_products?: Json
          affected_versions?: Json
          au_context?: Json
          category?: string
          cisa_kev?: boolean
          cisa_kev_added_at?: string | null
          cvss_score?: number | null
          cvss_vector?: string | null
          enriched_at?: string | null
          enrichment_version?: number
          epss_percentile?: number | null
          epss_score?: number | null
          exploit_available?: boolean
          exploited_in_wild?: boolean
          external_references?: Json
          id?: never
          identifier?: string
          identifier_type?: string
          ingested_at?: string
          is_stub?: boolean
          last_modified_at?: string | null
          lifecycle_status?: string
          patched_in_versions?: Json
          published_at?: string | null
          severity?: string | null
          source_feeds?: string[] | null
          subcategory?: string | null
          summary?: string | null
          tags?: string[] | null
          title?: string
        }
        Relationships: []
      }
      vulnerability_detections: {
        Row: {
          detected_at: string
          disposition: string
          evidence: Json
          id: number
          scan_id: string | null
          scanner: string
          target_type: string
          target_value: string
          target_version: string | null
          vulnerability_id: number
        }
        Insert: {
          detected_at?: string
          disposition?: string
          evidence?: Json
          id?: never
          scan_id?: string | null
          scanner: string
          target_type: string
          target_value: string
          target_version?: string | null
          vulnerability_id: number
        }
        Update: {
          detected_at?: string
          disposition?: string
          evidence?: Json
          id?: never
          scan_id?: string | null
          scanner?: string
          target_type?: string
          target_value?: string
          target_version?: string | null
          vulnerability_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_detections_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_exposure_checks: {
        Row: {
          check_config: Json
          check_type: string
          created_at: string
          enabled: boolean
          id: number
          scanner: string
          vulnerability_id: number
        }
        Insert: {
          check_config: Json
          check_type: string
          created_at?: string
          enabled?: boolean
          id?: never
          scanner: string
          vulnerability_id: number
        }
        Update: {
          check_config?: Json
          check_type?: string
          created_at?: string
          enabled?: boolean
          id?: never
          scanner?: string
          vulnerability_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_exposure_checks_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_ingestion_log: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          feed_name: string
          id: number
          records_fetched: number
          records_new: number
          records_skipped: number
          records_updated: number
          run_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          feed_name: string
          id?: never
          records_fetched?: number
          records_new?: number
          records_skipped?: number
          records_updated?: number
          run_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          feed_name?: string
          id?: never
          records_fetched?: number
          records_new?: number
          records_skipped?: number
          records_updated?: number
          run_at?: string
          status?: string
        }
        Relationships: []
      }
      vulnerability_mention_extractions: {
        Row: {
          cve_count: number
          extracted_at: string
          feed_item_id: number
          model_id: string | null
          prompt_version: string | null
          source_feed: string
        }
        Insert: {
          cve_count?: number
          extracted_at?: string
          feed_item_id: number
          model_id?: string | null
          prompt_version?: string | null
          source_feed: string
        }
        Update: {
          cve_count?: number
          extracted_at?: string
          feed_item_id?: number
          model_id?: string | null
          prompt_version?: string | null
          source_feed?: string
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_mention_extractions_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: true
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vulnerability_mentions: {
        Row: {
          claimed_exploited: boolean
          created_at: string
          cve_identifier: string
          excerpt: string | null
          feed_item_id: number
          id: number
          mention_url: string | null
          published_at: string | null
          source_feed: string
          vulnerability_id: number | null
        }
        Insert: {
          claimed_exploited?: boolean
          created_at?: string
          cve_identifier: string
          excerpt?: string | null
          feed_item_id: number
          id?: never
          mention_url?: string | null
          published_at?: string | null
          source_feed: string
          vulnerability_id?: number | null
        }
        Update: {
          claimed_exploited?: boolean
          created_at?: string
          cve_identifier?: string
          excerpt?: string | null
          feed_item_id?: number
          id?: never
          mention_url?: string | null
          published_at?: string | null
          source_feed?: string
          vulnerability_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerability_mentions_feed_item_id_fkey"
            columns: ["feed_item_id"]
            isOneToOne: false
            referencedRelation: "feed_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vulnerability_mentions_vulnerability_id_fkey"
            columns: ["vulnerability_id"]
            isOneToOne: false
            referencedRelation: "vulnerabilities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      analytics_event_daily: {
        Row: {
          day: string | null
          event_type: string | null
          events: number | null
        }
        Relationships: []
      }
      blog_to_scan_funnel: {
        Row: {
          content_readers: number | null
          readers_who_scanned: number | null
        }
        Relationships: []
      }
      content_post_funnel: {
        Row: {
          landing_path: string | null
          readers: number | null
          readers_who_contacted: number | null
          readers_who_scanned: number | null
        }
        Relationships: []
      }
      critical_vulnerabilities_au: {
        Row: {
          affected_products: Json | null
          banks_affected: Json | null
          category: string | null
          cisa_kev: boolean | null
          cvss_score: number | null
          epss_percentile: number | null
          epss_score: number | null
          exploited_in_wild: boolean | null
          gov_affected: Json | null
          identifier: string | null
          lifecycle_status: string | null
          patched_in_versions: Json | null
          published_at: string | null
          severity: string | null
          title: string | null
        }
        Insert: {
          affected_products?: Json | null
          banks_affected?: never
          category?: string | null
          cisa_kev?: boolean | null
          cvss_score?: number | null
          epss_percentile?: number | null
          epss_score?: number | null
          exploited_in_wild?: boolean | null
          gov_affected?: never
          identifier?: string | null
          lifecycle_status?: string | null
          patched_in_versions?: Json | null
          published_at?: string | null
          severity?: string | null
          title?: string | null
        }
        Update: {
          affected_products?: Json | null
          banks_affected?: never
          category?: string | null
          cisa_kev?: boolean | null
          cvss_score?: number | null
          epss_percentile?: number | null
          epss_score?: number | null
          exploited_in_wild?: boolean | null
          gov_affected?: never
          identifier?: string | null
          lifecycle_status?: string | null
          patched_in_versions?: Json | null
          published_at?: string | null
          severity?: string | null
          title?: string | null
        }
        Relationships: []
      }
      daily_cost_summary: {
        Row: {
          avg_cost_usd: number | null
          day: string | null
          event_count: number | null
          feature: string | null
          provider: string | null
          total_cost_usd: number | null
        }
        Relationships: []
      }
      daily_scans: {
        Row: {
          day: string | null
          scans: number | null
        }
        Relationships: []
      }
      feed_items_all: {
        Row: {
          archived: boolean | null
          body_md: string | null
          category: string | null
          channel: string | null
          country_code: string | null
          created_at: string | null
          description: string | null
          external_id: string | null
          id: number | null
          impersonated_brand: string | null
          provenance_tier:
            | Database["public"]["Enums"]["provenance_tier_t"]
            | null
          published_at: string | null
          source: string | null
          source_url: string | null
          tags: string[] | null
          title: string | null
          url: string | null
        }
        Relationships: []
      }
      feedback_disagreement_24h: {
        Row: {
          content_hashes: string[] | null
          n: number | null
          user_says: string | null
          verdict_given: string | null
        }
        Relationships: []
      }
      feedback_triage_queue: {
        Row: {
          analysis_id: string | null
          comment: string | null
          feedback_created_at: string | null
          feedback_id: number | null
          impact_weight: number | null
          impersonated_brand: string | null
          locale: string | null
          reason_codes: string[] | null
          report_created_at: string | null
          report_id: number | null
          report_source: string | null
          scam_type: string | null
          scrubbed_content: string | null
          submitted_content_hash: string | null
          training_consent: boolean | null
          triage_score: number | null
          uncertainty: number | null
          user_agent_family: string | null
          user_says: string | null
          verdict_confidence: number | null
          verdict_given: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verdict_feedback_scam_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "scam_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_impact_summary: {
        Row: {
          avg_loss: number | null
          channel: string | null
          currency: string | null
          effective_region: string | null
          high_risk_count: number | null
          impersonated_brands: string[] | null
          max_loss: number | null
          min_loss: number | null
          report_date: string | null
          reports_with_loss: number | null
          safe_count: number | null
          scam_type: string | null
          suspicious_count: number | null
          total_loss: number | null
          total_reports: number | null
        }
        Relationships: []
      }
      no_scan_visitor_rate: {
        Row: {
          day: string | null
          no_scan_pct: number | null
          no_scan_visitors: number | null
          total_visitors: number | null
        }
        Relationships: []
      }
      scam_reports_all: {
        Row: {
          analysis_result: Json | null
          archived: boolean | null
          channel: string | null
          cluster_id: number | null
          confidence_score: number | null
          country_code: string | null
          created_at: string | null
          delivery_method: string | null
          id: number | null
          impersonated_brand: string | null
          input_mode: string | null
          region: string | null
          reporter_hash: string | null
          scam_type: string | null
          scrubbed_content: string | null
          source: string | null
          verdict: string | null
          verified_scam_id: number | null
        }
        Relationships: []
      }
      scans_by_type: {
        Row: {
          day: string | null
          input_type: string | null
          scans: number | null
        }
        Relationships: []
      }
      scans_new_vs_returning: {
        Row: {
          day: string | null
          new_scanner_scans: number | null
          returning_scanner_scans: number | null
        }
        Relationships: []
      }
      threat_intel_daily_summary: {
        Row: {
          date: string | null
          distinct_scam_types: number | null
          high_risk_count: number | null
          region: string | null
          safe_count: number | null
          scam_reports_count: number | null
          suspicious_count: number | null
          top_brands: string[] | null
          top_scam_types: string[] | null
          total_checks: number | null
        }
        Relationships: []
      }
      threat_intel_entities: {
        Row: {
          channels: string[] | null
          distinct_scam_types: number | null
          earliest_report: string | null
          enrichment_data: Json | null
          entity_id: number | null
          entity_type: string | null
          feed_sources: string[] | null
          first_seen: string | null
          impersonated_brands: string[] | null
          last_seen: string | null
          latest_report: string | null
          linked_report_count: number | null
          normalized_value: string | null
          report_count: number | null
          risk_factors: Json | null
          risk_level: string | null
          risk_score: number | null
          scam_types: string[] | null
          verdicts: string[] | null
        }
        Relationships: []
      }
      threat_intel_scam_campaigns: {
        Row: {
          cluster_id: number | null
          cluster_type: string | null
          entities: Json | null
          entity_count: number | null
          first_seen: string | null
          last_seen: string | null
          member_count: number | null
          metadata: Json | null
          primary_brand: string | null
          primary_scam_type: string | null
          status: string | null
          total_loss: number | null
        }
        Relationships: []
      }
      threat_intel_urls: {
        Row: {
          brand_impersonated: string | null
          confidence_level: string | null
          confidence_score: number | null
          country_code: string | null
          domain: string | null
          feed_sources: string[] | null
          first_reported_at: string | null
          full_path: string | null
          google_safe_browsing: boolean | null
          is_active: boolean | null
          last_reported_at: string | null
          normalized_url: string | null
          primary_scam_type: string | null
          report_count: number | null
          ssl_days_remaining: number | null
          ssl_issuer: string | null
          ssl_valid: boolean | null
          subdomain: string | null
          tld: string | null
          unique_reporter_count: number | null
          url_id: number | null
          virustotal_malicious: number | null
          virustotal_score: string | null
          whois_created_date: string | null
          whois_is_private: boolean | null
          whois_registrant_country: string | null
          whois_registrar: string | null
        }
        Insert: {
          brand_impersonated?: string | null
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          domain?: string | null
          feed_sources?: string[] | null
          first_reported_at?: string | null
          full_path?: string | null
          google_safe_browsing?: boolean | null
          is_active?: boolean | null
          last_reported_at?: string | null
          normalized_url?: string | null
          primary_scam_type?: string | null
          report_count?: number | null
          ssl_days_remaining?: number | null
          ssl_issuer?: string | null
          ssl_valid?: boolean | null
          subdomain?: string | null
          tld?: string | null
          unique_reporter_count?: number | null
          url_id?: number | null
          virustotal_malicious?: number | null
          virustotal_score?: string | null
          whois_created_date?: string | null
          whois_is_private?: boolean | null
          whois_registrant_country?: string | null
          whois_registrar?: string | null
        }
        Update: {
          brand_impersonated?: string | null
          confidence_level?: string | null
          confidence_score?: number | null
          country_code?: string | null
          domain?: string | null
          feed_sources?: string[] | null
          first_reported_at?: string | null
          full_path?: string | null
          google_safe_browsing?: boolean | null
          is_active?: boolean | null
          last_reported_at?: string | null
          normalized_url?: string | null
          primary_scam_type?: string | null
          report_count?: number | null
          ssl_days_remaining?: number | null
          ssl_issuer?: string | null
          ssl_valid?: boolean | null
          subdomain?: string | null
          tld?: string | null
          unique_reporter_count?: number | null
          url_id?: number | null
          virustotal_malicious?: number | null
          virustotal_score?: string | null
          whois_created_date?: string | null
          whois_is_private?: boolean | null
          whois_registrant_country?: string | null
          whois_registrar?: string | null
        }
        Relationships: []
      }
      today_cost_total: {
        Row: {
          event_count: number | null
          total_cost_usd: number | null
        }
        Relationships: []
      }
      utm_attributed_conversions: {
        Row: {
          campaign: string | null
          conversions: number | null
          event_type: string | null
          medium: string | null
          source: string | null
          week: string | null
        }
        Relationships: []
      }
      v_phone_footprint_metrics: {
        Row: {
          anon_lookups: number | null
          avg_score: number | null
          critical_count: number | null
          day: string | null
          fleet_lookups: number | null
          high_count: number | null
          tier_generated: string | null
          user_lookups: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _prune_chunked: {
        Args: { p_interval: string; p_table: string; p_ts_col: string }
        Returns: number
      }
      advance_clone_lifecycle: {
        Args: {
          p_alert_id: number
          p_evidence?: Json
          p_mark_rechecked?: boolean
          p_to_state: string
        }
        Returns: undefined
      }
      aggregate_open_clone_alerts_by_brand: {
        Args: never
        Returns: {
          open_count: number
          target_brand_normalized: string
        }[]
      }
      aggregate_scam_report_brands: {
        Args: { p_min_count: number; p_since: string }
        Returns: {
          brand_normalized: string
          mention_count: number
          raw_brand: string
        }[]
      }
      anonymise_expired_footprints: { Args: never; Returns: number }
      apply_clone_urlscan_verdict: {
        Args: {
          p_alert_id: number
          p_classification: string
          p_evidence?: Json
        }
        Returns: Json
      }
      apply_netcraft_reconcile: {
        Args: {
          p_alert_ids: number[]
          p_stamp_takedown?: boolean
          p_to_state?: string
        }
        Returns: number
      }
      archive_feed_items_batch: {
        Args: { p_batch_size?: number; p_default_days?: number }
        Returns: {
          moved_items: number
        }[]
      }
      archive_old_urls: { Args: { p_archive_days?: number }; Returns: Json }
      archive_scam_reports_batch: {
        Args: {
          p_batch_size?: number
          p_default_days?: number
          p_high_risk_days?: number
        }
        Returns: {
          moved_cluster_links: number
          moved_links: number
          moved_reports: number
        }[]
      }
      archive_secondary_tables_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          rows_moved: number
          table_name: string
        }[]
      }
      assert_fleet_capacity: { Args: { p_org_id: string }; Returns: undefined }
      assign_clone_alert_batch: {
        Args: {
          p_approval_url: string
          p_auto_approved?: boolean
          p_batch_id: string
          p_email_body_html: string
          p_email_subject: string
          p_queue_ids: number[]
        }
        Returns: number
      }
      backfill_pfra_member_abns: { Args: never; Returns: number }
      brand_exposure_summary: {
        Args: { p_brand_normalized: string }
        Returns: {
          detected_count: number
          earliest: string
          examples: Json
        }[]
      }
      brand_normalize: { Args: { p_raw: string }; Returns: string }
      bulk_upsert_feed_crypto_wallet:
        | {
            Args: {
              p_address: string
              p_associated_domain?: string
              p_associated_url?: string
              p_chain: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_scam_type?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_address: string
              p_associated_domain?: string
              p_associated_url?: string
              p_chain: string
              p_country_code?: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_scam_type?: string
            }
            Returns: Json
          }
      bulk_upsert_feed_entity:
        | {
            Args: {
              p_entity_type: string
              p_feed_reference_url?: string
              p_feed_source?: string
              p_normalized_value: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_entity_type: string
              p_evidence_r2_key?: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_normalized_value: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_country_code?: string
              p_entity_type: string
              p_evidence_r2_key?: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_normalized_value: string
            }
            Returns: Json
          }
      bulk_upsert_feed_ip: {
        Args: {
          p_as_name?: string
          p_as_number?: number
          p_blocklist_count?: number
          p_country?: string
          p_feed_reference_url?: string
          p_feed_reported_at?: string
          p_feed_source?: string
          p_first_seen?: string
          p_ip_address: unknown
          p_ip_version?: number
          p_last_online?: string
          p_port?: number
          p_threat_type?: string
        }
        Returns: Json
      }
      bulk_upsert_feed_url:
        | {
            Args: {
              p_brand?: string
              p_domain: string
              p_feed_source?: string
              p_full_path?: string
              p_normalized_url: string
              p_scam_type?: string
              p_subdomain?: string
              p_tld?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_brand?: string
              p_domain: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_full_path?: string
              p_normalized_url: string
              p_scam_type?: string
              p_subdomain?: string
              p_tld?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_brand?: string
              p_domain: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_full_path?: string
              p_normalized_url: string
              p_scam_type?: string
              p_subdomain?: string
              p_tld?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_brand?: string
              p_country_code?: string
              p_domain: string
              p_feed_reference_url?: string
              p_feed_reported_at?: string
              p_feed_source?: string
              p_full_path?: string
              p_normalized_url: string
              p_scam_type?: string
              p_subdomain?: string
              p_tld?: string
            }
            Returns: Json
          }
      bump_clone_alert_netcraft_issue_attempt: {
        Args: { p_alert_id: number; p_error: string; p_status: number }
        Returns: number
      }
      check_breach_exposure: {
        Args: { p_identifier_hash: string; p_identifier_type: string }
        Returns: {
          au_doc_classes: string[]
          breach_id: number
          breach_slug: string
          data_classes: string[]
          disclosed_at: string
          entity_name: string
          threat_actor: string
        }[]
      }
      cleanup_expired_shop_checks: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      cleanup_old_reddit_posts: { Args: { p_days?: number }; Returns: number }
      clone_alert_recipient_is_suppressed: {
        Args: { p_email: string }
        Returns: boolean
      }
      clone_watch_brand_breakdown: {
        Args: { p_days?: number }
        Returns: {
          brand: string
          brand_notifications: number
          first_hit_at: string
          fp: number
          last_hit_at: string
          netcraft_submits: number
          pending: number
          total_candidates: number
          tp_actioned: number
          tp_confirmed: number
        }[]
      }
      clone_watch_classification_trends: {
        Args: { p_brand?: string; p_days?: number }
        Returns: {
          brand: string
          classified_count: number
          clone_count: number
          top_tactic: string
          week_start: string
        }[]
      }
      clone_watch_public_impact: {
        Args: { p_days?: number }
        Returns: {
          brand_notifications_total: number
          brands_protected: number
          candidates_total: number
          computed_at: string
          netcraft_submits_total: number
          tp_confirmed_total: number
          window_days: number
        }[]
      }
      clone_watch_takedown_stats: {
        Args: { p_days?: number }
        Returns: {
          computed_at: string
          fastest_minutes: number
          median_minutes: number
          p90_minutes: number
          slowest_minutes: number
          takedowns_total: number
          window_days: number
        }[]
      }
      clone_watch_weekly_metrics: {
        Args: { p_days?: number }
        Returns: {
          brands_touched: number
          candidates_total: number
          notifications_sent: number
          pending: number
          submissions_netcraft: number
          triaged_fp: number
          triaged_investigate: number
          triaged_tp: number
        }[]
      }
      commit_scam_cluster: {
        Args: {
          p_entity_count: number
          p_primary_brand: string
          p_primary_scam_type: string
          p_report_ids: number[]
        }
        Returns: number
      }
      compute_entity_risk_score: {
        Args: { p_entity_id: number }
        Returns: Json
      }
      compute_entity_risk_scores: {
        Args: { p_entity_ids: number[] }
        Returns: Json
      }
      consume_sim_swap_credit: {
        Args: { p_user_id: string }
        Returns: {
          consumed_bucket: string
          free_remaining: number
          paid_remaining: number
        }[]
      }
      count_todays_netcraft_issues: { Args: never; Returns: number }
      count_todays_takedown_submissions: { Args: never; Returns: number }
      create_organization: {
        Args: {
          p_abn?: string
          p_abn_entity_name?: string
          p_abn_verified?: boolean
          p_name?: string
          p_owner_id?: string
          p_role_title?: string
          p_sector?: string
          p_slug?: string
        }
        Returns: string
      }
      create_scam_report: {
        Args: {
          p_analysis_result?: Json
          p_channel?: string
          p_confidence_score: number
          p_country_code?: string
          p_delivery_method?: string
          p_idempotency_key?: string
          p_impersonated_brand?: string
          p_input_mode: string
          p_region?: string
          p_reporter_hash: string
          p_scam_type?: string
          p_scrubbed_content?: string
          p_source: string
          p_verdict: string
          p_verified_scam_id?: number
        }
        Returns: number
      }
      enforcement_case_counts: {
        Args: never
        Returns: {
          case_status: string
          n: number
        }[]
      }
      enqueue_clone_alert_notification: {
        Args: {
          p_alert_id: number
          p_brand: string
          p_candidate_domain: string
          p_candidate_url: string
          p_channel_type: string
          p_recipient: string
          p_scheduled_for: string
          p_severity_tier: string
        }
        Returns: number
      }
      ensure_monthly_partition: {
        Args: { p_month: string; p_parent: string }
        Returns: undefined
      }
      ensure_next_month_partitions: { Args: never; Returns: undefined }
      expire_stale_pending_clone_batches: {
        Args: { p_chunk_size?: number; p_older_than_hours?: number }
        Returns: number
      }
      fraud_manager_search: {
        Args: { p_query: string; p_type?: string }
        Returns: {
          entity_type: string
          entity_value: string
          first_seen: string
          last_seen: string
          report_count: number
          risk_level: string
          risk_score: number
          scam_types: string[]
        }[]
      }
      generate_api_key_record: {
        Args: { p_key_hash: string; p_org_name?: string; p_user_id: string }
        Returns: {
          created_at: string
          daily_limit: number
          id: number
          org_name: string
          tier: string
        }[]
      }
      generate_org_api_key: {
        Args: {
          p_key_hash: string
          p_org_id: string
          p_org_name?: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          daily_limit: number
          id: number
          org_name: string
          tier: string
        }[]
      }
      get_acnc_charities_missing_embedding: {
        Args: { p_limit?: number }
        Returns: {
          abn: string
          charity_legal_name: string
          other_names: string[]
        }[]
      }
      get_dashboard_summary: { Args: { p_days?: number }; Returns: Json }
      get_extension_tier: { Args: { p_install_id: string }; Returns: string }
      get_feedback_triage_summary: {
        Args: { p_filter?: string; p_limit?: number }
        Returns: Json
      }
      get_jurisdiction_summary: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_min_reports?: number
          p_target_country?: string
        }
        Returns: Json
      }
      get_onward_destinations: {
        Args: {
          p_channel: string
          p_has_financial_loss?: boolean
          p_has_pii_compromise?: boolean
          p_impersonated_brand: string
          p_scam_type: string
        }
        Returns: {
          contact_type: string
          default_enabled: boolean
          description: string
          destination: Database["public"]["Enums"]["onward_destination"]
          destination_key: string
          display_name: string
        }[]
      }
      get_threat_intel_export: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_entity_type?: string
          p_limit?: number
          p_offset?: number
          p_risk_level?: string
          p_scam_type?: string
        }
        Returns: Json
      }
      get_unembedded_narrative_feed_items: {
        Args: { p_limit?: number }
        Returns: {
          body_md: string
          category: string
          description: string
          id: number
          impersonated_brand: string
          source: string
          tags: string[]
          title: string
        }[]
      }
      get_unreported_entities: {
        Args: {
          p_limit?: number
          p_min_reports?: number
          p_offset?: number
          p_provider_code: string
          p_risk_level?: string
        }
        Returns: Json
      }
      get_user_org: {
        Args: { p_user_id: string }
        Returns: {
          member_role: string
          org_id: string
          org_name: string
          org_sector: string
          org_slug: string
          org_status: string
          org_tier: string
        }[]
      }
      get_vulnerability_exposure_report: {
        Args: {
          p_include_kev_only?: boolean
          p_limit?: number
          p_min_severity?: string
          p_products: Json
        }
        Returns: Json
      }
      get_world_scam_stats: {
        Args: { days_back?: number }
        Returns: {
          country_code: string
          scam_count: number
        }[]
      }
      grant_sim_swap_credits: {
        Args: {
          p_bucket: string
          p_credits: number
          p_reason: string
          p_stripe_ref: string
          p_user_id: string
        }
        Returns: {
          free_remaining: number
          paid_remaining: number
          recovery_remaining: number
        }[]
      }
      increment_check_stats: {
        Args: { p_region?: string; p_verdict: string }
        Returns: undefined
      }
      ingest_clone_alert_brand_reply: {
        Args: {
          p_alert_id: number
          p_body_excerpt: string
          p_brand: string
          p_classified_as: string
          p_from_email: string
          p_meta?: Json
          p_raw_message_id: string
          p_subject: string
        }
        Returns: number
      }
      link_report_entity: {
        Args: {
          p_entity_id: number
          p_extraction_method?: string
          p_report_id: number
          p_role?: string
        }
        Returns: number
      }
      list_active_monitored_brands: {
        Args: never
        Returns: {
          aliases: string[]
          brand: string
          brand_normalized: string
          legitimate_domains: string[]
        }[]
      }
      list_clone_alerts_for_netcraft_reconcile: {
        Args: {
          p_cadence_hours?: number
          p_max_age_days?: number
          p_uuid_limit?: number
        }
        Returns: {
          alerts: Json
          netcraft_uuid: string
        }[]
      }
      list_clone_alerts_for_recheck: {
        Args: { p_cadence_hours?: number; p_limit?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          last_rechecked_at: string
          lifecycle_state: string
          recheck_count: number
          urlscan_classification: string
        }[]
      }
      list_clone_alerts_for_urlscan_rescan: {
        Args: { p_limit?: number; p_stale_after_hours?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          inferred_target_domain: string
          last_scanned_at: string
          previous_classification: string
        }[]
      }
      list_clone_alerts_pending_netcraft_auto: {
        Args: { p_daily_cap?: number; p_min_confidence?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          inferred_target_domain: string
          severity_tier: string
          signals: Json
        }[]
      }
      list_clone_alerts_pending_netcraft_issue: {
        Args: { p_max_age_days?: number; p_uuid_limit?: number }
        Returns: {
          alerts: Json
          netcraft_uuid: string
        }[]
      }
      list_clone_alerts_pending_netcraft_poll: {
        Args: { p_limit?: number }
        Returns: {
          candidate_url: string
          id: number
          netcraft_uuid: string
          submitted_at: string
        }[]
      }
      list_clone_alerts_pending_notification_batch: {
        Args: { p_limit?: number; p_severity?: string }
        Returns: {
          alert_id: number
          brand: string
          candidate_domain: string
          candidate_url: string
          channel_type: string
          enqueued_at: string
          id: number
          recipient: string
          severity_tier: string
        }[]
      }
      list_clone_alerts_pending_preclassify: {
        Args: { p_limit?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          inferred_target_domain: string
        }[]
      }
      list_clone_alerts_pending_triage: {
        Args: { p_corroboration_priority?: boolean; p_limit?: number }
        Returns: {
          auto_classification_attack_intent: string
          auto_classification_clone_tactic: string
          auto_classification_confidence: number
          auto_classification_is_clone: boolean
          auto_classification_reason: string
          candidate_domain: string
          candidate_url: string
          corroboration_mention_count: number
          corroboration_source_counts: Json
          cross_stream_corroborated: boolean
          first_seen_at: string
          id: number
          inferred_target_domain: string
          likely_tp: boolean
          severity_tier: string
          signals: Json
          triage_status: string
          urlscan_classification: string
          urlscan_effective_url: string
          urlscan_scanned_at: string
          urlscan_screenshot_url: string
        }[]
      }
      list_clone_alerts_pending_urlscan: {
        Args: { p_limit?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          first_seen_at: string
          id: number
          inferred_target_domain: string
        }[]
      }
      list_clone_alerts_pending_urlscan_retrieve: {
        Args: {
          p_limit?: number
          p_max_failure_streak?: number
          p_min_age_minutes?: number
        }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          urlscan_evidence: Json
          urlscan_uuid: string
        }[]
      }
      list_clone_alerts_pending_urlscan_submit: {
        Args: {
          p_limit?: number
          p_max_failure_streak?: number
          p_min_confidence?: number
        }
        Returns: {
          candidate_domain: string
          candidate_url: string
          id: number
          inferred_target_domain: string
        }[]
      }
      list_clone_alerts_unbatched_for_prepare: {
        Args: { p_limit?: number }
        Returns: {
          alert_id: number
          brand: string
          candidate_domain: string
          candidate_url: string
          channel_type: string
          enqueued_at: string
          id: number
          recipient: string
          severity_tier: string
        }[]
      }
      list_enforcement_cases: {
        Args: { p_include_closed?: boolean; p_limit?: number }
        Returns: {
          acts_on_parked: boolean
          candidate_domain: string
          candidate_url: string
          case_id: number
          case_status: string
          channel: string
          channel_autonomy: string
          clone_alert_id: number
          created_at: string
          evidence_bundle: Json
          external_ref: string
          lifecycle_state: string
          next_action_at: string
          submitted_at: string
          target_brand_normalized: string
          updated_at: string
        }[]
      }
      list_enforcement_cases_pending_send: {
        Args: { p_limit?: number }
        Returns: {
          candidate_domain: string
          candidate_url: string
          case_id: number
          channel: string
          clone_alert_id: number
          evidence_bundle: Json
          target_brand_normalized: string
        }[]
      }
      list_long_running_queries: {
        Args: { min_minutes: number }
        Returns: {
          application_name: string
          minutes: number
          pid: number
          query_preview: string
        }[]
      }
      list_recently_notified_brands: {
        Args: { p_cooldown_hours?: number; p_legitimate_domains: string[] }
        Returns: {
          last_notified_at: string
          legitimate_domain: string
        }[]
      }
      list_takedown_cases_for_reemergence: {
        Args: { p_cadence_hours?: number; p_limit?: number }
        Returns: {
          candidate_domain: string
          case_id: number
          channel: string
          clone_alert_id: number
          last_reemergence_check_at: string
        }[]
      }
      load_clone_alert_batch: {
        Args: { p_batch_id: string }
        Returns: {
          alert_id: number
          approval_status: string
          approved_at: string
          brand: string
          candidate_domain: string
          candidate_url: string
          channel_type: string
          email_body_html: string
          email_subject: string
          id: number
          prepared_at: string
          recipient: string
          severity_tier: string
        }[]
      }
      log_api_usage: {
        Args: { p_endpoint: string; p_key_hash: string }
        Returns: undefined
      }
      lookup_pfra_member: {
        Args: { p_abn?: string; p_name?: string }
        Returns: {
          abn: string
          member_type: string
          name: string
          source_url: string
        }[]
      }
      mark_clone_alert_notifications_processed: {
        Args: { p_queue_ids: number[]; p_status?: string }
        Returns: number
      }
      mark_stale_crypto_wallets: {
        Args: { p_stale_days?: number }
        Returns: Json
      }
      mark_stale_ips: { Args: { p_stale_days?: number }; Returns: Json }
      mark_stale_urls: { Args: { p_stale_days?: number }; Returns: Json }
      mark_takedown_reemergence_checked: {
        Args: { p_case_id: number; p_reemerged: boolean }
        Returns: undefined
      }
      match_charities_by_embedding: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
        }
        Returns: {
          abn: string
          charity_legal_name: string
          charity_website: string
          similarity: number
          state: string
          town_city: string
        }[]
      }
      match_feed_items_narrative: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_since_days?: number
        }
        Returns: {
          body_md: string
          category: string
          description: string
          id: number
          impersonated_brand: string
          published_at: string
          similarity: number
          source: string
          tags: string[]
          title: string
          url: string
        }[]
      }
      match_reddit_intel: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
        }
        Returns: {
          brands_impersonated: string[]
          feed_item_id: number
          id: string
          intent_label: string
          modus_operandi: string
          narrative_summary: string
          processed_at: string
          similarity: number
        }[]
      }
      match_reddit_intel_themes: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
        }
        Returns: {
          description: string
          id: string
          ioc_phone_count: number
          ioc_url_count: number
          member_count: number
          similarity: number
          slug: string
          title: string
        }[]
      }
      match_scam_reports: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_since_days?: number
        }
        Returns: {
          channel: string
          confidence_score: number
          created_at: string
          id: number
          impersonated_brand: string
          region: string
          scam_type: string
          scrubbed_content: string
          similarity: number
          verdict: string
        }[]
      }
      match_scam_reports_hybrid: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
          p_query_text: string
          p_rrf_k?: number
          p_since_days?: number
        }
        Returns: {
          bm25_rank: number
          channel: string
          confidence_score: number
          created_at: string
          dense_rank: number
          id: number
          impersonated_brand: string
          region: string
          rrf_score: number
          scam_type: string
          scrubbed_content: string
          similarity: number
          verdict: string
        }[]
      }
      match_themes_by_centroid: {
        Args: {
          p_match_count?: number
          p_min_signal_strength?: string
          p_min_similarity?: number
          p_query_embedding: string
        }
        Returns: {
          id: string
          member_count: number
          modus_operandi: string
          narrative: string
          representative_brands: string[]
          signal_strength: string
          similarity: number
          slug: string
          title: string
          top_tactic_tags: string[]
        }[]
      }
      match_verified_scams: {
        Args: {
          p_match_count?: number
          p_min_similarity?: number
          p_query_embedding: string
        }
        Returns: {
          channel: string
          confidence_score: number
          created_at: string
          id: number
          impersonated_brand: string
          region: string
          scam_type: string
          similarity: number
          summary: string
        }[]
      }
      merge_clone_alert_submission: {
        Args: {
          p_alert_id: number
          p_key: string
          p_set_triage_status?: string
          p_value: Json
        }
        Returns: {
          id: number
          submitted_to: Json
          triage_status: string
        }[]
      }
      merge_clone_alert_submission_bulk: {
        Args: { p_alert_ids: number[]; p_key: string; p_value: Json }
        Returns: number
      }
      merge_entity_enrichment_data: {
        Args: { p_entity_id: number; p_key: string; p_value: Json }
        Returns: undefined
      }
      merge_takedown_case: {
        Args: {
          p_acts_on_parked?: boolean
          p_alert_id: number
          p_autonomy: string
          p_channel: string
          p_evidence?: Json
          p_external_ref?: string
          p_next_action_at?: string
          p_status?: string
        }
        Returns: number
      }
      persist_clone_alert_urlscan: {
        Args: {
          p_alert_id: number
          p_classification: string
          p_set_triage_status?: string
          p_urlscan_evidence: Json
          p_urlscan_uuid: string
        }
        Returns: {
          id: number
          triage_status: string
          urlscan_classification: string
        }[]
      }
      phone_footprint_internal: {
        Args: { p_msisdn_e164: string }
        Returns: Json
      }
      prune_cost_telemetry: { Args: { p_days?: number }; Returns: number }
      prune_feed_http_cache: { Args: { p_days?: number }; Returns: number }
      prune_feed_ingestion_log: { Args: { p_days?: number }; Returns: number }
      prune_telco_events: {
        Args: never
        Returns: {
          rows_deleted: number
          table_name: string
        }[]
      }
      purge_old_clone_alert_queue_rows: {
        Args: { p_chunk_size?: number; p_older_than_days?: number }
        Returns: number
      }
      purge_old_fp_clone_alerts: {
        Args: { p_chunk_size?: number; p_older_than_days?: number }
        Returns: number
      }
      record_brand_notification_sent: {
        Args: { p_batch_id: string; p_provider_message_id?: string }
        Returns: number
      }
      record_clone_alert_urlscan_submit: {
        Args: { p_alert_id: number; p_evidence?: Json; p_urlscan_uuid: string }
        Returns: undefined
      }
      record_clone_watch_classification: {
        Args: {
          p_alert_id: number
          p_attack_intent: string
          p_brand: string
          p_candidate_domain: string
          p_clone_tactic: string
          p_confidence: number
          p_input_tokens: number
          p_is_clone: boolean
          p_model_id: string
          p_output_tokens: number
          p_prompt_version: string
          p_reason: string
          p_risk_indicators: Json
        }
        Returns: undefined
      }
      record_financial_impact: {
        Args: {
          p_estimated_loss: number
          p_loss_currency?: string
          p_report_id: number
          p_target_country?: string
          p_target_region?: string
        }
        Returns: Json
      }
      record_vulnerability_mention: {
        Args: {
          p_claimed_exploited: boolean
          p_cve_identifier: string
          p_excerpt: string
          p_feed_item_id: number
          p_identifier_type: string
          p_mention_url: string
          p_published_at: string
          p_source_feed: string
          p_stub_category: string
          p_stub_title: string
        }
        Returns: number
      }
      refresh_cost_telemetry_daily_rollup: {
        Args: { p_days?: number }
        Returns: number
      }
      refresh_feedback_triage_queue: { Args: never; Returns: undefined }
      refund_sim_swap_credit: {
        Args: { p_bucket: string; p_reason?: string; p_user_id: string }
        Returns: {
          free_remaining: number
          paid_remaining: number
        }[]
      }
      replace_brand_register: { Args: { p_rows: Json }; Returns: number }
      report_scam_entity: {
        Args: {
          p_country_code?: string
          p_entity_type: string
          p_normalized_value: string
          p_raw_value?: string
          p_report_id?: number
          p_role?: string
        }
        Returns: {
          entity_id: number
          is_new: boolean
          report_count: number
        }[]
      }
      resolve_brand: { Args: { p_raw: string }; Returns: string }
      review_verdict_severity: { Args: { v: string }; Returns: number }
      search_charities: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          abn: string
          charity_legal_name: string
          charity_website: string
          is_delisted: boolean
          similarity_score: number
          state: string
          town_city: string
        }[]
      }
      set_clone_alert_triage: {
        Args: {
          p_admin_id: string
          p_alert_id: number
          p_notes?: string
          p_status: string
        }
        Returns: {
          id: number
          triage_at: string
          triage_status: string
        }[]
      }
      set_user_admin: {
        Args: { p_is_admin: boolean; p_user_id: string }
        Returns: undefined
      }
      submit_provider_report: {
        Args: {
          p_entity_id: number
          p_payload?: Json
          p_provider_code: string
          p_reference_number?: string
          p_report_type: string
        }
        Returns: Json
      }
      sweep_inactive_monitors: { Args: never; Returns: number }
      sync_phone_footprint_entitlements: {
        Args: {
          p_current_period_end: string
          p_features: Json
          p_monthly_lookup_limit: number
          p_org_id: string
          p_refresh_cadence_min: string
          p_saved_numbers_limit: number
          p_sku: string
          p_status: string
          p_stripe_price_id: string
          p_stripe_subscription_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      sync_subscription_tier: {
        Args: { p_api_key_id: number; p_plan: string; p_status: string }
        Returns: undefined
      }
      terminate_stuck_query: { Args: { target_pid: number }; Returns: boolean }
      transition_clone_alert_batch: {
        Args: {
          p_admin_id?: string
          p_batch_id: string
          p_new_status: string
          p_provider_message_id?: string
        }
        Returns: {
          observed_brand: string
          observed_recipient: string
          observed_status: string
          updated_count: number
        }[]
      }
      update_shop_check_signal: {
        Args: {
          p_composite_score?: number
          p_id: string
          p_patch: Json
          p_verdict?: string
        }
        Returns: boolean
      }
      upsert_clone_alerts_batch: { Args: { p_rows: Json }; Returns: number }
      upsert_feed_item: {
        Args: {
          p_category?: string
          p_channel?: string
          p_country_code?: string
          p_description?: string
          p_external_id: string
          p_impersonated_brand?: string
          p_r2_image_key?: string
          p_reddit_image_url?: string
          p_source: string
          p_source_created_at?: string
          p_source_url?: string
          p_title: string
          p_upvotes?: number
          p_url?: string
          p_verified?: boolean
        }
        Returns: Json
      }
      upsert_push_token: {
        Args: {
          p_device_id: string
          p_expo_token: string
          p_platform: string
          p_region?: string
          p_user_id?: string
        }
        Returns: undefined
      }
      upsert_reddit_watchlist_candidate: {
        Args: {
          p_brand_normalized: string
          p_mention_count: number
          p_raw_brand: string
          p_resolved_canonical: string
        }
        Returns: undefined
      }
      upsert_scam_entity: {
        Args: {
          p_canonical_entity_id?: number
          p_canonical_entity_table?: string
          p_entity_type: string
          p_normalized_value: string
          p_raw_value?: string
        }
        Returns: Json
      }
      upsert_scam_url: {
        Args: {
          p_analysis_id?: number
          p_brand_impersonated?: string
          p_channel?: string
          p_domain: string
          p_full_path?: string
          p_normalized_url: string
          p_region?: string
          p_reporter_hash?: string
          p_scam_type?: string
          p_source_type?: string
          p_subdomain?: string
          p_tld?: string
        }
        Returns: Json
      }
      upsert_scan_result: {
        Args: {
          p_grade: string
          p_overall_score: number
          p_result: Json
          p_scan_type: string
          p_target: string
          p_target_display: string
          p_visibility?: string
        }
        Returns: {
          id: number
          is_new: boolean
          share_token: string
        }[]
      }
      upsert_shop_check: {
        Args: {
          p_composite_score: number
          p_idempotency_key: string
          p_referrer_source?: string
          p_request_id?: string
          p_signal: Json
          p_source_surface?: string
          p_url_hash: string
          p_url_normalized: string
          p_verdict: string
        }
        Returns: string
      }
      upsert_shop_review_finding: {
        Args: {
          p_average_rating: number
          p_composite_score: number
          p_distribution: Json
          p_domain: string
          p_fake_likelihood: number
          p_reasons: Json
          p_review_app: string
          p_sample_url: string
          p_total_reviews: number
          p_verdict: string
        }
        Returns: undefined
      }
      upsert_site_and_store_audit: {
        Args: {
          p_category_scores: Json
          p_domain: string
          p_duration_ms: number
          p_fetch_error?: Json
          p_grade: string
          p_normalized_url: string
          p_overall_score: number
          p_partial?: boolean
          p_raw_headers?: Json
          p_recommendations: Json
          p_test_results: Json
        }
        Returns: {
          audit_id: number
          share_token: string
        }[]
      }
      upsert_watchlist_candidate: {
        Args: {
          p_brand_normalized: string
          p_raw_brand: string
          p_resolved_canonical: string
          p_source: string
          p_source_count: number
        }
        Returns: undefined
      }
      user_owns_key_hash: { Args: { p_key_hash: string }; Returns: boolean }
    }
    Enums: {
      onward_destination:
        | "scamwatch"
        | "reportcyber"
        | "acma_email_spam"
        | "idcare"
        | "brand_abuse"
        | "ask_arthur_feed"
        | "openphish"
        | "apwg"
      onward_status:
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "failed"
        | "skipped"
        | "manual_review"
      provenance_tier_t:
        | "tier_1_regulator"
        | "tier_2_industry"
        | "tier_3_curated"
        | "tier_4_osint"
        | "tier_5_community"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      onward_destination: [
        "scamwatch",
        "reportcyber",
        "acma_email_spam",
        "idcare",
        "brand_abuse",
        "ask_arthur_feed",
        "openphish",
        "apwg",
      ],
      onward_status: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "failed",
        "skipped",
        "manual_review",
      ],
      provenance_tier_t: [
        "tier_1_regulator",
        "tier_2_industry",
        "tier_3_curated",
        "tier_4_osint",
        "tier_5_community",
      ],
    },
  },
} as const
