#!/usr/bin/env python3
"""
Notion 프로젝트 대시보드 & 변경 로그 — env/.env 또는 루트 .env 의
NOTION_TOKEN, NOTION_DATABASE_ID 를 사용합니다.

  python3 scripts/notion_helper.py init-dashboard   # Setup / Design / Status 페이지 3개 생성
  python3 scripts/notion_helper.py update-log     # git 변경 요약으로 로그 행 추가 (노션 업데이트)

데이터베이스의「제목」타입 프로퍼티 이름은 API로 자동 감지합니다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

# ── 경로 ─────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[1]
IDS_PATH = REPO_ROOT / "scripts" / ".notion_dashboard_ids.json"
PACKAGE_JSON = REPO_ROOT / "package.json"


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        print("python-dotenv 가 없습니다. pip3 install python-dotenv", file=sys.stderr)
        sys.exit(1)

    for p in (REPO_ROOT / "env" / ".env", REPO_ROOT / ".env"):
        if p.is_file():
            load_dotenv(p, override=False)


def require_notion_client():
    try:
        from notion_client import Client  # noqa: F401
        from notion_client.errors import APIResponseError  # noqa: F401
    except ImportError:
        print("notion-client 가 없습니다. pip3 install notion-client", file=sys.stderr)
        sys.exit(1)


def get_client():
    require_notion_client()
    from notion_client import Client

    token = (os.environ.get("NOTION_TOKEN") or "").strip()
    if not token:
        print(
            "NOTION_TOKEN 이 설정되지 않았습니다. env/.env 또는 .env 에 추가하세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    return Client(auth=token, notion_version="2022-06-28")


def normalize_notion_uuid(raw: str) -> str:
    """URL·복사본에서 온 32자리 hex 또는 UUID 형태를 표준 UUID로 맞춤."""
    s = raw.strip()
    m = re.search(r"([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})", s, re.I)
    if m:
        s = m.group(1)
    s = s.replace("-", "")
    if len(s) == 32 and all(c in "0123456789abcdefABCDEF" for c in s):
        x = s.lower()
        return f"{x[0:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:32]}"
    return raw.strip()


def get_database_id() -> str:
    db = (os.environ.get("NOTION_DATABASE_ID") or "").strip()
    if not db:
        print(
            "NOTION_DATABASE_ID 가 설정되지 않았습니다. env/.env 또는 .env 에 추가하세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    return normalize_notion_uuid(db)


def resolve_title_property(client, database_id: str) -> str:
    from notion_client.errors import APIResponseError

    try:
        db = client.databases.retrieve(database_id=database_id)
    except APIResponseError as e:
        if e.status == 404:
            print(
                "Notion DB를 찾을 수 없습니다.\n"
                "  • NOTION_DATABASE_ID 가「데이터베이스」ID인지 확인 (일반 페이지 ID와 다름)\n"
                "  • 해당 DB를 연동(Integration)에「연결」했는지 Notion에서 확인",
            )
        else:
            print(f"Notion API 오류 ({e.status}): {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Notion 요청 실패: {e}")
        sys.exit(1)
    props = db.get("properties") or {}
    for name, meta in props.items():
        if meta.get("type") == "title":
            return name
    print("데이터베이스에 title 타입 프로퍼티가 없습니다.", file=sys.stderr)
    sys.exit(1)


def title_prop_payload(text: str) -> dict[str, Any]:
    return {"title": [{"type": "text", "text": {"content": text[:2000]}}]}


def create_db_page(client, database_id: str, title_prop: str, title: str) -> str:
    page = client.pages.create(
        parent={"database_id": database_id},
        properties={title_prop: title_prop_payload(title)},
    )
    return str(page["id"])


def append_blocks(client, page_id: str, blocks: list[dict[str, Any]]) -> None:
    chunk = 90
    for i in range(0, len(blocks), chunk):
        client.blocks.children.append(page_id, children=blocks[i : i + chunk])


def paragraph(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def heading2(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def heading3(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_3",
        "heading_3": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def bullet(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {
            "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
        },
    }


def table_block(headers: list[str], rows: list[list[str]]) -> dict[str, Any]:
    w = len(headers)
    children: list[dict[str, Any]] = []
    all_rows = [headers] + rows
    for r in all_rows:
        cells: list[list[dict[str, Any]]] = []
        for c in range(w):
            val = r[c] if c < len(r) else ""
            cells.append(
                [{"type": "text", "text": {"content": str(val)[:2000]}}],
            )
        children.append(
            {
                "object": "block",
                "type": "table_row",
                "table_row": {"cells": cells},
            },
        )
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": w,
            "has_column_header": True,
            "has_row_header": False,
            "children": children,
        },
    }


def run_cmd(args: list[str]) -> str:
    try:
        r = subprocess.run(args, cwd=REPO_ROOT, capture_output=True, text=True, timeout=60)
        return (r.stdout or "").strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"(실행 실패: {e})"


def read_package_tables() -> tuple[list[list[str]], list[list[str]]]:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    deps = [[k, str(v)] for k, v in sorted((data.get("dependencies") or {}).items())]
    dev = [[k, str(v)] for k, v in sorted((data.get("devDependencies") or {}).items())]
    return deps, dev


def os_info_rows() -> list[list[str]]:
    import platform

    rows: list[list[str]] = [
        ["platform", platform.platform()],
        ["system", platform.system()],
        ["machine", platform.machine()],
        ["Python", sys.version.split()[0]],
    ]
    if sys.platform == "darwin":
        rows.append(["macOS (sw_vers)", run_cmd(["sw_vers"]).replace("\n", " · ")])
    rows.append(["Node.js", run_cmd(["node", "-v"]) or "(node 없음)"])
    return rows


def cmd_git_summary() -> str:
    st = run_cmd(["git", "status", "--porcelain"])
    diff_stat = run_cmd(["git", "diff", "--stat"])
    recent = run_cmd(["git", "log", "-5", "--oneline"])
    parts = []
    if st:
        parts.append("## 변경된 파일 (porcelain)\n" + st[:8000])
    else:
        parts.append("## 작업 트리: 깨끗함 (uncommitted 없음)")
    if diff_stat:
        parts.append("\n## diff --stat\n" + diff_stat[:8000])
    if recent:
        parts.append("\n## 최근 커밋\n" + recent)
    return "\n".join(parts)[:12000]


def build_setup_blocks() -> list[dict[str, Any]]:
    deps, dev = read_package_tables()
    os_rows = os_info_rows()
    blocks: list[dict[str, Any]] = [
        heading2("개요"),
        paragraph(
            "Mac mini 로컬에서 Ginit 앱(Expo / React Native)을 개발할 때의 "
            "런타임·OS·주요 npm 의존성 스냅샷입니다. (스크립트 실행 시점 기준)"
        ),
        heading3("OS / 런타임"),
        table_block(["항목", "값"], os_rows),
        heading3("dependencies"),
        table_block(["패키지", "버전"], deps[:45]),
    ]
    if len(deps) > 45:
        blocks.append(paragraph(f"… 외 {len(deps) - 45}개 dependencies 는 package.json 참고."))
    blocks += [
        heading3("devDependencies"),
        table_block(["패키지", "버전"], dev[:25]),
    ]
    if len(dev) > 25:
        blocks.append(paragraph(f"… 외 {len(dev) - 25}개 devDependencies."))
    return blocks


def build_design_blocks() -> list[dict[str, Any]]:
    return [
        heading2("Ginit UI / 디자인 컨셉"),
        paragraph(
            "React Native + Expo Router 기반. 시안 톤: Warm & Human Gathering — "
            "밝은 서피스, 소프트 보더, 카드형 레이아웃, 브랜드 그라데이션 CTA."
        ),
        heading3("앱 구조 (요약)"),
        bullet("expo-router: `app/` 파일 기반 라우팅 (탭·스택·모달)"),
        bullet("`app/(tabs)/`: 메인 탭 (모임·지도·친구·채팅·프로필 등)"),
        bullet("`app/create/`: 모임 생성 마법사·상세 (`details.tsx` 등 대형 폼)"),
        bullet("`components/create/`: 일정·장소 후보 편집 카드 등 도메인 UI"),
        bullet("`constants/ginit-theme.ts`: 색·타이포·radius·glass 토큰"),
        bullet("`src/lib/`: Supabase·NLP·지도·인증 등 비 UI 로직"),
        heading3("주요 컬러 (GinitTheme.colors)"),
        table_block(
            ["토큰", "HEX / 값"],
            [
                ["bg", "#FFFFFF"],
                ["primary (브랜드 딥)", "#673AB7"],
                ["accent (민트)", "#86D3B7"],
                ["accent2 (옐로)", "#F4C84A"],
                ["text", "#0F172A"],
                ["textMuted", "#64748B"],
                ["danger", "#DC2626"],
                ["brandGradient", "#86D3B7 → #F4C84A"],
                ["ctaGradient", "#86D3B7 → #73C7FF"],
            ],
        ),
        paragraph("레거시 호환: themeMainColor / pointOrange 는 점진 마이그레이션용으로 유지."),
    ]


def build_status_blocks() -> list[dict[str, Any]]:
    return [
        heading2("진행 현황 (요약)"),
        heading3("완료·반영된 작업 (예시)"),
        bullet("Expo SDK 54 / RN 0.81 / React 19 기반 앱 골격"),
        bullet("Firebase Auth + Google / Supabase 연동 패턴"),
        bullet("모임 생성 플로우: 일정 NLP·음성 입력·주말 후보 미리보기·장소 검색"),
        bullet("모임 상세: 날짜 제안 모달, 일정 후보 병합, Notion 대시보드 스크립트"),
        bullet("채팅·프로필·탭 구조 UX 개선 (대화 요약 기준)"),
        heading3("To-Do (다음에 할 일)"),
        bullet("백엔드·RLS 정책과 실서비스 데이터 연동 검증"),
        bullet("알림·딥링크·오프라인 시나리오 점검"),
        bullet("스토어 빌드·TestFlight / 내부 배포 파이프라인"),
        bullet("노션: 이 스크립트로 주기적 update-log 운영"),
        paragraph(
            "상세 이슈는 Linear / GitHub Issues 등과 링크해 두면 좋습니다."
        ),
    ]


def cmd_init_dashboard(*, force: bool = False) -> None:
    load_env()
    client = get_client()
    db_id = get_database_id()
    title_prop = resolve_title_property(client, db_id)

    if IDS_PATH.is_file() and not force:
        print(f"이미 초기화됨: {IDS_PATH} (다시 만들려면 python3 scripts/notion_helper.py init-dashboard --force)", file=sys.stderr)
        data = json.loads(IDS_PATH.read_text(encoding="utf-8"))
        for k, v in data.items():
            print(f"  {k}: {v}")
        return

    if force and IDS_PATH.is_file():
        IDS_PATH.unlink()

    titles = {
        "setup": "Ginit — Setup (Mac mini / deps)",
        "design": "Ginit — Design (UI & colors)",
        "status": "Ginit — Status (done & todo)",
    }
    ids: dict[str, str] = {}
    builders = {
        "setup": build_setup_blocks,
        "design": build_design_blocks,
        "status": build_status_blocks,
    }
    for key, ttl in titles.items():
        pid = create_db_page(client, db_id, title_prop, ttl)
        ids[key] = pid
        append_blocks(client, pid, builders[key]())
        print(f"OK {key}: page {pid}")

    IDS_PATH.write_text(json.dumps(ids, indent=2), encoding="utf-8")
    print(f"저장: {IDS_PATH}")


def cmd_update_log() -> None:
    """코드 변경 요약을 노션 DB에 새 행으로 추가 (대화에서 '노션 업데이트' 시 실행)."""
    load_env()
    client = get_client()
    db_id = get_database_id()
    title_prop = resolve_title_property(client, db_id)

    kst = timezone(timedelta(hours=9))
    now = datetime.now(kst).strftime("%Y-%m-%d %H:%M KST")
    body = cmd_git_summary()
    title = f"Change log — {now}"

    page_id = create_db_page(client, db_id, title_prop, title)
    blocks = [
        heading2("Git / 작업 트리 요약"),
        paragraph("(자동 생성 — `scripts/notion_helper.py update-log`)"),
    ]
    # 긴 본문은 문단 여러 개로 분할
    for line in body.split("\n"):
        if line.strip():
            blocks.append(paragraph(line))
    append_blocks(client, page_id, blocks)
    print(f"OK update-log: page {page_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Notion Ginit dashboard & changelog")
    parser.add_argument(
        "command",
        choices=["init-dashboard", "update-log"],
        help="init-dashboard: Setup/Design/Status 3페이지 | update-log: git 요약 로그",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="init-dashboard: 기존 ids 파일 무시하고 페이지 다시 생성",
    )
    args = parser.parse_args()
    if args.command == "init-dashboard":
        cmd_init_dashboard(force=args.force)
    else:
        cmd_update_log()


if __name__ == "__main__":
    main()
