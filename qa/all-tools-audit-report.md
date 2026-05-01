# Tool Audit Report

**Generated:** 2026-05-01T08:56:19.059Z

## Summary

- Total tools: **122**
- Passed: **122**
- Warnings: **0**
- Failed: **0**

## All tools

| Tool | Category | Risk Class | Risk Level | Maturity | Status |
| --- | --- | --- | --- | --- | --- |
| `analyze_email_risk` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `analyze_engagement` | CRM | READ_ONLY | - | heuristic | pass |
| `analyze_github_repo` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `analyze_serp` | RESEARCH | READ_ONLY | - | real_external | pass |
| `audit_seo` | RESEARCH | READ_ONLY | - | real_external | pass |
| `auto_engage_linkedin` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `auto_engage_reddit` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `auto_engage_twitter` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `auto_reply_reddit` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `auto_reply_twitter` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `browser_analyze_page` | BROWSER | READ_ONLY | - | config_dependent | pass |
| `browser_click` | BROWSER | WRITE | - | real_external | pass |
| `browser_evaluate_js` | BROWSER | WRITE | - | real_external | pass |
| `browser_extract` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_fill_form` | BROWSER | WRITE | - | real_external | pass |
| `browser_get_cookies` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_get_text` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_hover` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_manage_tabs` | BROWSER | WRITE | - | real_external | pass |
| `browser_mouse_click` | BROWSER | WRITE | - | real_external | pass |
| `browser_navigate` | BROWSER | WRITE | - | real_external | pass |
| `browser_press_key` | BROWSER | WRITE | - | real_external | pass |
| `browser_save_as_pdf` | BROWSER | WRITE | - | real_external | pass |
| `browser_screenshot` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_scroll` | BROWSER | READ_ONLY | - | real_external | pass |
| `browser_select_option` | BROWSER | WRITE | - | real_external | pass |
| `browser_set_cookies` | BROWSER | WRITE | - | real_external | pass |
| `browser_type_text` | BROWSER | WRITE | - | real_external | pass |
| `browser_upload_file` | BROWSER | WRITE | - | real_external | pass |
| `browser_wait_for` | BROWSER | READ_ONLY | - | real_external | pass |
| `check_dependencies` | RESEARCH | READ_ONLY | - | heuristic | pass |
| `classify_text` | RESEARCH | READ_ONLY | - | llm_passthrough | pass |
| `classify_ticket` | RESEARCH | READ_ONLY | - | llm_passthrough | pass |
| `code_execute` | RESEARCH | WRITE | - | real_external | pass |
| `compare_contracts` | DOCUMENT | READ_ONLY | - | llm_passthrough | pass |
| `compile_executive_summary` | KNOWLEDGE | READ_ONLY | - | real_external | pass |
| `compute_statistics` | SPREADSHEET | READ_ONLY | - | heuristic | pass |
| `create_calendar_event` | CALENDAR | WRITE | - | config_dependent | pass |
| `create_email_sequence` | EMAIL | WRITE | - | real_external | pass |
| `cross_verify` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `deduplicate_contacts` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `deploy_to_vercel` | WEBHOOK | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `discover_posting_platforms` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `draft_email` | EMAIL | WRITE | - | config_dependent | pass |
| `enrich_company` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `enrich_contact` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `estimate_tech_debt` | RESEARCH | READ_ONLY | - | heuristic | pass |
| `extract_document_data` | DOCUMENT | READ_ONLY | - | llm_passthrough | pass |
| `extract_obligations` | DOCUMENT | READ_ONLY | - | llm_passthrough | pass |
| `file_read` | DOCUMENT | READ_ONLY | - | real_external | pass |
| `file_write` | DOCUMENT | WRITE | - | real_external | pass |
| `find_availability` | CALENDAR | READ_ONLY | - | llm_passthrough | pass |
| `find_decision_makers` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `find_document` | KNOWLEDGE | READ_ONLY | - | config_dependent | pass |
| `forecast_cashflow` | SPREADSHEET | READ_ONLY | - | heuristic | pass |
| `generate_board_report` | DOCUMENT | WRITE | - | llm_passthrough | pass |
| `generate_image` | DOCUMENT | WRITE | - | config_dependent | pass |
| `generate_offer_letter` | DOCUMENT | WRITE | - | heuristic | pass |
| `generate_qbr_deck` | DOCUMENT | WRITE | - | llm_passthrough | pass |
| `generate_report` | DOCUMENT | WRITE | - | llm_passthrough | pass |
| `generate_seo_report` | RESEARCH | READ_ONLY | - | real_external | pass |
| `generate_winback` | EMAIL | READ_ONLY | - | llm_passthrough | pass |
| `github_create_repo` | RESEARCH | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `github_list_files` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `github_push_files` | RESEARCH | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `github_read_file` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `github_review_pr` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `gmail_read_inbox` | EMAIL | READ_ONLY | - | experimental | pass |
| `gmail_send_email` | EMAIL | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `ingest_document` | KNOWLEDGE | WRITE | - | config_dependent | pass |
| `list_calendar_events` | CALENDAR | READ_ONLY | - | config_dependent | pass |
| `list_directory` | DOCUMENT | READ_ONLY | - | real_external | pass |
| `lookup_crm_contact` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `lookup_customer` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `memory_retrieve` | KNOWLEDGE | READ_ONLY | - | real_external | pass |
| `memory_store` | KNOWLEDGE | WRITE | - | real_external | pass |
| `monitor_brand_mentions` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `monitor_company_signals` | RESEARCH | READ_ONLY | - | real_external | pass |
| `monitor_competitors` | RESEARCH | READ_ONLY | - | real_external | pass |
| `monitor_rankings` | RESEARCH | READ_ONLY | - | real_external | pass |
| `monitor_regulations` | RESEARCH | READ_ONLY | - | real_external | pass |
| `parse_financial_csv` | SPREADSHEET | READ_ONLY | - | heuristic | pass |
| `parse_spreadsheet` | SPREADSHEET | READ_ONLY | - | heuristic | pass |
| `pdf_analyze` | DOCUMENT | READ_ONLY | - | config_dependent | pass |
| `pdf_extract_text` | DOCUMENT | READ_ONLY | - | real_external | pass |
| `personalize_email` | EMAIL | READ_ONLY | - | heuristic | pass |
| `post_job_listing` | DOCUMENT | WRITE | - | heuristic | pass |
| `post_to_linkedin` | BROWSER | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `post_to_reddit` | BROWSER | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `post_to_twitter` | BROWSER | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `predict_churn` | CRM | READ_ONLY | - | heuristic | pass |
| `read_email` | EMAIL | READ_ONLY | - | config_dependent | pass |
| `research_keywords` | RESEARCH | READ_ONLY | - | real_external | pass |
| `sandbox_create` | BROWSER | WRITE | - | real_external | pass |
| `sandbox_destroy` | BROWSER | DESTRUCTIVE | - | real_external | pass |
| `sandbox_exec` | BROWSER | EXTERNAL_SIDE_EFFECT | - | real_external | pass |
| `sandbox_get_preview_url` | BROWSER | READ_ONLY | - | real_external | pass |
| `sandbox_install_deps` | BROWSER | WRITE | - | real_external | pass |
| `sandbox_start_dev_server` | BROWSER | EXTERNAL_SIDE_EFFECT | - | real_external | pass |
| `sandbox_write_file` | BROWSER | WRITE | - | real_external | pass |
| `schedule_email` | EMAIL | WRITE | - | real_external | pass |
| `score_lead` | CRM | READ_ONLY | - | heuristic | pass |
| `screen_resume` | DOCUMENT | READ_ONLY | - | heuristic | pass |
| `search_deals` | CRM | READ_ONLY | - | llm_passthrough | pass |
| `search_knowledge` | KNOWLEDGE | READ_ONLY | - | real_external | pass |
| `search_knowledge_base` | KNOWLEDGE | READ_ONLY | - | real_external | pass |
| `send_email` | EMAIL | EXTERNAL_SIDE_EFFECT | - | config_dependent | pass |
| `send_webhook` | WEBHOOK | EXTERNAL_SIDE_EFFECT | - | real_external | pass |
| `summarize_document` | DOCUMENT | READ_ONLY | - | llm_passthrough | pass |
| `track_budget` | KNOWLEDGE | WRITE | - | real_external | pass |
| `track_content_performance` | KNOWLEDGE | WRITE | - | real_external | pass |
| `track_customer_health` | CRM | WRITE | - | real_external | pass |
| `track_email_engagement` | EMAIL | WRITE | - | real_external | pass |
| `track_lead_pipeline` | CRM | WRITE | - | real_external | pass |
| `track_okrs` | KNOWLEDGE | WRITE | - | real_external | pass |
| `update_crm_record` | CRM | WRITE | - | llm_passthrough | pass |
| `verify_document` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `verify_email_deliverability` | CRM | READ_ONLY | - | real_external | pass |
| `verify_identity` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `verify_transaction` | RESEARCH | READ_ONLY | - | config_dependent | pass |
| `web_fetch` | RESEARCH | READ_ONLY | - | real_external | pass |
| `web_search` | RESEARCH | READ_ONLY | - | real_external | pass |
