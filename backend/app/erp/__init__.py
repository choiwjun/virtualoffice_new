"""ERP(space-daily/dailylog) read-only 연동 어댑터.

경계 설계: ErpReader 인터페이스 뒤에 Mock/Postgres 구현을 두어
목 기반 개발 → 실 DB 전환을 설정(ERP_DATABASE_URL)만으로 수행.
정본: docs/planning/03-erp-integration.md (2026-07-02 라이브 스키마 검증).
"""
