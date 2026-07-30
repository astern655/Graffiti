# 입력 도면 데이터 — 출처 정리 & 사용법

이 MVP의 입력은 **2D 물류창고/건물 도면**이다. 아래는 실제 오픈 도면 자료 출처와, 이 데모가 어떤 형태로 도면을 넣는지, 실제 블루프린트를 나중에 끼우는 방법을 정리한 것.

## 1. 데모가 지금 쓰는 방식 (구현됨)

- 도면을 **하드코딩된 벡터 데이터**로 내장 (`data.js`). `file://`로 열어도 CORS 없이 동작하도록 `fetch`·외부 파일 로드는 쓰지 않음.
- **5개 건물 지오메트리 × 3개 자재 시나리오 = 15개 레이아웃**. 같은 건물이라도 보관품(자재)이 다르면 최적 방화벽 배치가 달라지는 것을 보여주는 구성.
- 각 구획: `{id, name, x, y, w, d, material}` (m 단위 정수 그리드). 인접 경계(후보 방화벽)는 공유벽에서 **자동 생성**(`computeGraph`).

## 2. 실제 오픈 도면 자료 (디지털화 소스 후보)

### A. 벡터 도면 데이터셋 — 구획 좌표가 이미 있어 디지털화 쉬움

| 데이터셋 | 규모/형식 | 좋은 점 | 주의 | 링크 |
|---|---|---|---|---|
| FloorPlanCAD | 15,000+ CAD, SVG 벡터, 주거~상업 | 상업 건물 포함, SVG 폴리곤 추출 용이 | 연구용 라이선스 | https://floorplancad.github.io/ · https://huggingface.co/datasets/Voxel51/FloorPlanCAD |
| CubiCasa5K | 5,000, SVG 벡터, 80+ 카테고리(storage 포함) | 방 경계·인접 명확 | 핀란드 주거용 | https://github.com/CubiCasa/CubiCasa5k |
| RPLAN | 80,788, 벡터 + 연결 그래프 | 인접 그래프가 이미 있음 → EDGES에 직결 | 아시아 주거용 | (논문/배포 검색) |
| MSD (Modified Swiss Dwellings) | 대규모 멀티유닛, Kaggle, 그래프 | 복합 건물, 다운로드 쉬움 | 주거 위주 | https://github.com/caspervanengelenburg/msd |
| ROBIN | 건물 도면 저장소 | 바로 이미지 받기 | 규모 작음 | https://github.com/gesstalt/ROBIN |

### B. 물류창고 실제 레이아웃 — 서사에 맞음 (수작업 픽)

물류창고 전용 오픈 데이터셋은 사실상 없다. 아래 템플릿 갤러리에서 구획 뚜렷한 것을 눈으로 골라 배경 이미지로 사용.

- EdrawMax 창고 레이아웃 템플릿 — https://edrawmax.wondershare.com/examples/warehouse-layout.html
- ConceptDraw 창고 블루프린트 — https://www.conceptdraw.com/examples/warehouse-blueprint-maker
- Coohom 창고 평면도 — https://www.coohom.com/article/warehouse-floor-plan-layout-free
- Roboflow Universe "Floor Plans 500" (이미지+박스) — https://universe.roboflow.com/university-y9nbi/floor-plans-500

## 3. 라이선스 주의

"오픈"이 곧 상업 재사용 허용은 아님. FloorPlanCAD·CubiCasa5K는 **연구용 라이선스**, 템플릿 갤러리는 사이트 약관 확인 필요. 해커톤 데모/발표 범위면 대개 문제없으나 **발표 자료에 출처 명시** 권장.

## 4. 실제 블루프린트를 나중에 끼우는 법 (확장 포인트)

임의 도면 이미지를 2일 안에 자동 파싱(CV)하는 건 신뢰성 문제로 제외했다. 대신 **배경 이미지 + 수작업 구획 지정** 경로로 확장 가능하도록 데이터 포맷이 열려 있음:

1. 오픈 창고 도면 PNG를 확보 → 레이아웃에 `image` 필드로 배경 지정(캔버스에 깔기, 미구현 훅).
2. 그 위에서 구획을 사각형으로 떠서 `comps`에 좌표 입력 + 보관품(자재) 지정.
   - **자재는 도면에 없는 정보** → 사람이 지정하는 결정(추측 금지).
3. `computeGraph`가 공유벽에서 후보 방화벽 경계를 자동 생성 → 엔진 그대로 사용.

즉 "실제 도면 → 구획·자재 디지털화 → 최적 방화벽 가이드"의 디지털화 단계만 수작업이고, 위험 분석·최적화·가이드 산출은 전부 자동.

## 5. 데이터 확장 시 지켜야 할 제약

- **후보 경계 ≤ 16개** (전수탐색 2^N). 실제로는 구획 5~8개 → 경계 6~12개 권장. `selftest.js`가 초과를 잡아냄.
- 좌표는 **정수 그리드**, 구획은 겹침 없이 타일링(공유벽 정확 판정). `selftest.js`가 겹침·연결성 검증.
- 자재 키는 `data.js`의 `MATERIALS`에 정의된 것만 사용.
