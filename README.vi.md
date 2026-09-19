<h1 align="center">Paseo SLP</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">Bộ role Supervisor–Lead–Peer độc lập dành cho Paseo.</p>

Cài plugin, kích hoạt trên daemon của bạn, chọn **SLP Supervisor** trong
Paseo và giao mục tiêu. Role instruction tự nạp; Supervisor quan sát Lead
hiện có hoặc tạo Lead theo assignment, Lead giao Peer qua Paseo. Bạn có thể
nhắn tiếp trong session Supervisor đã có, không cần nhập lại prompt role.

Ngoài prompt bạn gõ, mỗi seat còn nhận role contract, quy tắc delegation,
spawn kit, policy locators kèm sha256 và managed runtime helpers — phần
này được inject lúc tạo session và không hiện trong tab agent. Chi tiết ở
[Kiến trúc plugin](docs/architecture.md).

## Yêu cầu

- Paseo `>=0.8.0 <0.9.0` với `pluginsEnabled: true` trong `config.json` của
  daemon.
- Node >=22 trên máy daemon (plugin tự resolve Node ổn định — không dùng
  binary Electron — lúc kích hoạt).
- Codex/Pi/Devin/Claude CLI tương ứng với các family provider bạn muốn dùng,
  cùng credentials của từng family trên máy daemon.
- Pi cần hỗ trợ `--append-system-prompt` lặp lại (bản Pi hiện được kiểm tra
  có hỗ trợ).
- `mcp.enabled` trong effective config của daemon phải là `true` để kích
  hoạt.

## Cài đặt

Package phân phối dưới dạng Paseo plugin. Cài lên daemon chạy công việc:

```bash
# Từ Git source — plugin nằm trong thư mục plugin/ của repo:
paseo plugin install <git-source>:plugin --ref <ref>

# Từ checkout local (development):
paseo plugin install /absolute/path/to/paseo-slp/plugin
```

`<git-source>` là mọi thứ `git clone` chấp nhận — ví dụ URL GitHub của repo
hoặc `file:///absolute/path/to/paseo-slp` cho clone local. Daemon checkout
ref vào thư mục quản lý `$PASEO_HOME/plugins/paseo-slp/<id>/` rồi chạy bước
`build` trong manifest (`npm install` trong `plugin/`) trước khi nạp. Kiểm
tra bằng `paseo plugin ls` — plugin phải đạt trạng thái `running`.

Cài đặt chỉ đăng ký plugin; chưa thay đổi cấu hình agent. Kích hoạt là bước
riêng và tường minh (bên dưới). Installer standalone trước plugin được ghi
tại [docs/reports/legacy-install.md](docs/reports/legacy-install.md) — không chạy song song
với plugin.

## Kích hoạt

Mở **SLP** trên sidebar (hoặc "Open SLP manager" từ command palette) — hoặc
gọi RPC `activate`. Surface hỏi daemon home cần quản lý, xác nhận mapping
host/home, và yêu cầu cửa sổ chỉnh
sửa quản trị độc quyền: trong lúc một operation chạy, không writer nào khác
được sửa `config.json` — plugin tự kiểm tra điều kiện này và báo conflict
thay vì chạy đua.

Kích hoạt sẽ:

- Materialize payload nhúng vào
  `<paseo-home>/slp-runtime/<candidate-sha256>/` — bất biến theo release.
- Resolve Node ổn định cùng executable của bốn family provider (probe
  `--version` thật; family không resolve được thì fail closed).
- Ghi launch shim vào `slp-runtime/launchers/<launchset-sha256>/` — đường
  dẫn ổn định mà providers tham chiếu, để đổi runtime không làm hỏng session
  đang chạy.
- Patch `config.json` với mười hai provider
  `slp-{codex,pi,devin,claude}-{supervisor,lead,peer}`, hai saved profile
  **SLP Supervisor** và **SLP Lead**, đồng thời bật MCP injection.
- Ghi receipt vào `slp-runtime/state/receipt.json` — journal của mọi
  operation, dùng cho drift detection và recovery.

Nút **Inspect** trên surface là read-only — dùng nó để xem trạng thái
(`INACTIVE`/`ACTIVE`/`RECOVERY_REQUIRED`), binding hiện tại, availability
của từng family và conflicts trước khi đổi gì.

- Không tạo agent trong lúc cài hay kích hoạt. Ba role vẫn giữ nguyên.
- **Peer không cần saved profile** — Lead chọn runtime Peer từ pool theo
  project trong `.paseo-slp/slp-routing.json`.
- Repo giữ tactics trong `.paseo-slp/workspace-protocol.md`; onboarding
  hướng dẫn cấu hình cả hai file.
- Nếu entry có sẵn đã chiếm một provider/profile ID của SLP, kích hoạt fail
  với `COLLISION` và giữ nguyên entry đó — `adoptIdentical` chỉ nhận entry
  khớp chính xác.
- Nếu raw config và live config lệch nhau, hoặc một entry thuộc sở hữu bị
  sửa ngoài journal, trạng thái chuyển `RECOVERY_REQUIRED`; chạy **Reconcile
  → inspect** để kiểm tra lại và resolve trước khi thử lại.

## Nâng cấp

Bản cài qua Git được cập nhật qua Paseo:

```bash
paseo plugin update paseo-slp
```

Daemon fetch source, build checkout mới và reload plugin. Kích hoạt lại sau
đó sẽ rebind sang candidate mới: runtime mới materialize cạnh runtime cũ
trong `slp-runtime/`, launchers được build lại, còn session đang chạy giữ
provider process cũ cho tới khi xong — đường dẫn launch shim ổn định qua các
candidate. Rebind là idempotent: kích hoạt hai lần cùng một candidate là
`no-op`.

Bản cài directory thì reload:

```bash
paseo plugin reload paseo-slp
```

## Gỡ kích hoạt và gỡ cài

**Deactivate** (màn hình SLP, hoặc RPC `deactivate`) tháo pack ra: gỡ mười
hai provider và hai profile, khôi phục cờ MCP injection về giá trị trước
kích hoạt, đồng thời giữ nguyên mọi thứ khác trong `config.json`. File
runtime, launchers và receipt được **giữ lại** trong `slp-runtime/` để các
session đang chạy không gián đoạn — deactivate không bao giờ xóa chúng. Nếu
giá trị `enabled` của MCP đổi, hoặc một entry được quản lý bị sửa ngoài
journal, deactivate sẽ bị chặn thay vì ghi đè ngầm.

Sau khi deactivate (hoặc với bản cài chưa từng kích hoạt), gỡ đăng ký
plugin:

```bash
paseo plugin remove paseo-slp
```

`remove` chỉ xóa cấu hình plugin — không đụng `slp-runtime/`, trạng thái
`.paseo-slp/` trong repo, hay managed checkout.

## Bắt đầu

Cài đặt làm một lần; mỗi task chỉ lặp bước 4–5.

1. Cài và kích hoạt plugin (ở trên).
2. Tuỳ chọn, một lần: trên màn SLP, card **Communication language** đặt
   ngôn ngữ mà mọi seat được quản lý dùng cho report, handback và trả lời
   bạn. Bật toggle, nhập ví dụ `English`, Apply — giá trị nằm trong
   state của plugin, được inject vào mỗi session mới, không cần
   re-activation. Để tắt thì mỗi model tự theo ngôn ngữ của prompt; không
   có gì được inject.
3. Khởi tạo và onboard từng repo công việc một lần (bên dưới).
4. Mỗi task: **New agent** trong workspace của repo → profile
   **SLP Supervisor** → title `Supervisor — <task>` → objective:

   ```text
   <task — ví dụ sửa bug A, thêm feature B, review change C>
   ```

5. Gửi, rồi chat tiếp trong session đó — đó là toàn bộ giao diện.
   Supervisor hỏi ở đó khi cần bạn và report kết quả ở đó khi việc xong.

   Phía sau prompt, seat đã mang sẵn role contract, delegation rules và
   spawn kit (xem [Kiến trúc plugin](docs/architecture.md)): nó quan sát
   hoặc tạo Lead, Lead chọn Peer từ pool của repo. Bạn không cần gọi tên
   các seat con — chúng là agent Paseo thường, mở ra xem cũng được.

Hai dòng trong prompt là bảo hiểm rẻ, không phải yêu cầu:

- `Repository:` — seat tự resolve repo từ workspace của nó; ghi dòng này
  khi workspace của session có thể không phải target, hoặc task đụng
  nhiều repo.
- `Report về session này…` — handback không có chỗ nào khác để đi; dòng
  này đánh dấu prompt là bounded assignment có deliverable thay vì cuộc
  chat mở, để một seat idle đọc là "đang chờ Lead" chứ không phải "xong
  rồi".

**SLP Lead** cũng dùng được nếu bạn muốn giao trực tiếp cho Lead — cùng
flow, bớt một tầng. Supervisor và Lead đã có procedure chọn profile con,
giữ parentage và dùng finish notifications.

## Skills

Skill onboarding dạy agent cách cài đặt bộ pack này cho một repo.

```bash
npx skills add duongvm57/paseo-slp --skill paseo-slp-onboarding
```

- `paseo-slp-onboarding` — phỏng vấn bạn về quyết định pool Peer, ngôn ngữ
  giao tiếp và notebook của Supervisor, rồi ghi `.paseo-slp/` đúng chuẩn.
  Sau khi cài, nó tự trigger khi bạn yêu cầu agent onboard/setup SLP.

(`paseo-slp-e2e` không cần cài — nó chạy từ source checkout; xem
[E2E](#e2e).)

Agent chưa có skill? Dán prompt này vào agent bất kỳ:

```text
Help me understand and set up Paseo SLP. Read
https://raw.githubusercontent.com/duongvm57/paseo-slp/main/docs/agent-guide.md
first, then walk me through it step by step.
```

## Agent profiles

Để đặt model và reasoning riêng cho từng role:

1. Mở **Settings → host chạy công việc → Agents → Agent profiles**.
2. Sửa **SLP Supervisor** hoặc **SLP Lead**.
3. Chọn provider `slp-codex-{role}`, `slp-pi-{role}`, `slp-devin-{role}` hoặc
   `slp-claude-{role}` tương ứng, rồi chọn **Model**, **Thinking**, **Mode**
   nếu provider có và features rồi **Save**.
4. Khi tạo session trực tiếp, chọn profile đã lưu trong model picker. Với
   Peer, dùng onboarding để thiết lập pool trong repo; Lead tự chọn option
   phù hợp từ pool rồi truyền đúng provider/model/settings đó vào
   `create_agent`.

**Thinking** là reasoning effort; **Mode** là quyền/approval, hai thiết lập
khác nhau. Chọn giá trị do provider/model thực tế cung cấp. Agent dùng
`list_profiles`, `list_models`, `inspect_provider` để discover; trường profile
`thinkingOptionId` được truyền thành `settings.thinkingOptionId` khi tạo
agent.

Sửa profile ảnh hưởng lần chọn/launch sau, không cập nhật session đã chạy.
Với session hiện hữu, Paseo có `update_agent` để đổi model/thinking trong
provider đó nếu provider hỗ trợ. Profile vẫn giữ mặc định riêng cho các
session tương lai. Xem
[Agent profiles của Paseo](https://paseo.sh/docs/agent-profiles.md).

## Cấu hình repository

Khởi tạo repo công việc một lần. CLI nằm trong runtime đã materialize —
`runtimePath` của binding đang active (xem trên màn hình SLP/status) là
`<paseo-home>/slp-runtime/<candidate-sha256>`:

```bash
SLP_RT="$HOME/.paseo/slp-runtime/<candidate-sha256>"
node "$SLP_RT/bin/slp.mjs" init /absolute/job-repo --apply
```

Lệnh chỉ tạo các file còn thiếu và giữ nguyên từng file đã có:

- `.paseo-slp/workspace-protocol.md`: quy trình, mức rủi ro, proof gate,
  budget và quyền fallback.
- `.paseo-slp/slp-routing.json`: pool runtime của Peer. Init seed sẵn
  [skeleton theo loại việc](src/templates/slp-routing.json) — các ghế đều
  disabled, đặt tên theo kiểu tác vụ; onboarding điền model thật từ
  discovery trước delegation. Khi repo chưa có file này, runtime đọc
  catalog user-scope `$PASEO_HOME/slp-routing.json` (mặc định `~/.paseo`).
- `.paseo-slp/notebook.md`: notebook mặc định của Supervisor; protocol ghi
  nhận owner và cách truy xuất thực tế (file này hoặc `timeline:<agentId>`).

Catalog user-scope `$PASEO_HOME/slp-routing.json` **không** do plugin tạo —
kích hoạt chỉ quản lý `config.json` và `slp-runtime/`. File này do
`slp.mjs init` hoặc onboarding ghi giúp bạn; khi chưa có, repo không có
catalog riêng đơn giản là chưa có pool fallback (không phải lỗi).
Deactivation và `plugin remove` không bao giờ đụng nó — đã tồn tại là của
bạn.

### Onboarding

Skill onboarding được cài riêng để agent có thể auto-trigger. Từ repo muốn
dùng, cài project-local (tạo `.agents/skills/paseo-slp-onboarding` và có thể
commit cùng repo):

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --copy --yes
```

Hoặc cài global cho mọi repo của user:

```bash
npx skills@latest add /absolute/path/to/paseo-slp \
  --skill paseo-slp-onboarding --global --copy --yes
```

Sau khi package được publish lên GitHub, thay đường dẫn local bằng
URL/repository đã publish, ví dụ `duongvm57/paseo-slp`. Dùng project mode
hoặc thêm `--global` như trên; truyền `--agent <name>` nếu muốn chỉ cài cho
một agent thay vì mọi agent được phát hiện. Với lệnh này, project skill nằm ở
`.agents/skills`, global skill nằm ở `~/.agents/skills`; Codex và Pi discover
trực tiếp hai scope đó, còn installer cũng link chúng vào thư mục skill riêng
của từng agent (ví dụ `.claude/skills`) nên Claude cũng nhận được theo cùng
cách. Kiểm tra bằng `npx skills@latest list` hoặc thêm
`--global` cho user scope. Mở session mới sau khi cài, rồi yêu cầu
onboard/setup SLP cho repo; description của skill sẽ trigger workflow. Xem
[skill nguồn](skills/paseo-slp-onboarding/SKILL.md).

Protocol và catalog là hai file tách riêng: protocol là hướng dẫn vận hành,
JSON là dữ liệu có thể kiểm tra tự động và đổi thường xuyên. Cả hai thuộc
repo và có thể version cùng code; không nhúng JSON vào Markdown. Lead đọc
protocol và pool trước mỗi Peer delegation, chọn option theo task/budget, rồi
truyền constraint liên quan vào assignment. Worktree mới cần các file trong
base candidate hoặc bản copy được cho phép; mỗi worktree đọc cấu hình của
chính nó.

### Import catalog có sẵn

Nếu đã có bảng global từ bản trước, import một lần vào repo muốn dùng:

```bash
node "$SLP_RT/bin/slp.mjs" init /absolute/job-repo \
  --routing-from /absolute/previous/slp-routing.json --apply
```

Import chỉ tạo catalog khi chưa có; không ghi đè, trộn ngầm hay tiếp tục liên
kết với file nguồn. Sau đó Human chỉnh bản trong repo. Repo chưa có catalog
thì đọc catalog user-scope `$PASEO_HOME/slp-routing.json`; catalog rỗng trong
repo vẫn authoritative (chặn delegation) cho tới khi bị xóa. Không bao giờ
đọc catalog của repo khác.

## Cách các role hoạt động

Protocol chọn topology và proof gate theo risk: task nhỏ có thể dùng một
Engineer; việc nhạy về architecture/lifecycle có Architect, independent
Reviewer hoặc nhiều lane. Role Peer nhận disposition qua assignment, độc lập
với option runtime. Lead giữ integration và technical acceptance; Supervisor
giữ quan sát và relay quyết định của Human.

Supervisor/Lead dùng event trước, heartbeat làm safety net khi task cần và có
authority; cadence và điều kiện dừng thuộc protocol/assignment. Reference
được cài kèm hướng dẫn tạo/xóa heartbeat của đúng session, ghi causal
notebook, recovery và 20 anti-pattern từ guide. Role chỉ dẫn đọc reference
theo tình huống; Peer nhận các constraint liên quan qua assignment. Đây là
policy cho agent sử dụng primitive Paseo — package không có monitoring
daemon hay semantic detector; `monitor` (bên dưới) là scan tín hiệu
delta-only do caller chủ động gọi.

## Peer runtime pool

**Nguồn runtime:** Supervisor/Lead dùng hai saved profile Human cấu hình
trong Paseo. Peer dùng pool `.paseo-slp/slp-routing.json` của repo, hoặc
catalog user-scope `$PASEO_HOME/slp-routing.json` khi repo chưa có. Mỗi
option có provider `pi`/`codex`/`devin`/`claude`, model, settings, `suitableFor`,
`avoidFor`, `notes`, `priority` và trạng thái `enabled`/`availability`. Lead
chọn theo công việc, không gán cứng Engineer/Architect/Reviewer vào model.
Hai Peer có thể khác provider/model/effort mà không thêm saved profile.
[Skeleton theo loại việc](src/templates/slp-routing.json) được seed sẵn cho
thấy hình dạng: mỗi ghế đặt tên theo kiểu tác vụ, `model` để trống cho tới
khi điền từ discovery thực tế trên host.

Lead đọc pool mới, ghi lý do chọn và kiểm tra option/hash bằng `prepare`
trước khi launch. Không có pool/option hợp lệ ở cả hai scope thì hoàn thiện
onboarding; không fallback sang `slp-peer`, settings của Lead hay catalog
repo khác. `priority` là gợi ý lựa chọn, không thay thế đánh giá suitability
và budget.

### Fallback quota của Peer

Cấu hình ngay trong `.paseo-slp/slp-routing.json`:

```json
"quotaFallback": { "enabled": true, "optionIds": ["luna-code", "glm-design"] }
```

Các ID phải tồn tại trong `options`; dùng ID thực tế của repo. Mặc định tắt
hoặc thiếu cấu hình thì dừng nhánh hết quota. Lead chọn bundle còn khả dụng,
phù hợp và nằm trong danh sách này; `prepare` nhận thêm
`route.quotaFallbackFrom` là ID option bị quota. Không tự đổi model ngoài
pool bằng `update_agent`, không dùng provider default, và không coi model
khác cùng tài khoản là quota mới. Nếu không còn fallback hợp lệ thì báo
BLOCKED; giữ ownership và bằng chứng trước khi handoff.

## Handoff provider của Lead

Đổi Lead sang Pi khi Codex hết quota: đổi provider của **SLP Lead** thành
`slp-pi-lead`, chọn model/thinking tương ứng và Save cho các launch sau. Để
chuyển công việc đang chạy, nhắn Supervisor: "Codex hết quota, chuyển Lead
này sang Pi, giữ scope hiện tại và handoff công việc theo profile đã lưu."
Supervisor kiểm tra Lead cũ đã ngừng điều phối, thu state/evidence và tạo
Lead mới với cùng policy trên Pi. Nếu Lead cũ không trả lời được, Supervisor
lấy state từ timeline/artifact; không cần gọi lại model hết quota chỉ để xin
summary. Khi không có Supervisor, Human chuyển handoff sang session Lead mới
và xác nhận ownership.

Đây là handoff sang session mới: host không đổi provider tại chỗ và không tự
chuyển parentage của Peer. Procedure giữ Peer IDs/ownership, xử lý quyền truy
cập descendants và wake sources; Lead mới nhận việc sau khi kiểm tra trạng
thái bàn giao. Nếu muốn tự động chọn provider dự phòng, ghi trước fallback và
budget/authority trong protocol; chỉ lỗi quota không tự cấp quyền đổi
provider. Đổi model/thinking trong cùng provider có thể dùng `update_agent`,
tùy capability của provider.

## Quy ước tên agent

Tên agent dùng quy chuẩn `Supervisor — <task>`, `Lead — <task>` và
`Peer — <Disposition> — <task>`. Ví dụ `Peer — Engineer — checkout totals`
và `Peer — Reviewer — checkout totals` phân biệt hai nhiệm vụ dù cùng role
Peer. Truyền `taskLabel` và `disposition` vào `prepare`; nhiều reviewer thì
thêm phạm vi vào taskLabel, như `checkout totals / API`. Khi bỏ qua,
taskLabel lấy tên thư mục repo và disposition hiển thị `General`. Resume giữ
tên; session handoff mới thêm `Handoff`. Agent ID vẫn là định danh dùng cho
ownership và gửi báo cáo.

## CLI

### `prepare` / `prepare-handoff`

Đường offline tùy chọn: `prepare` nhận role, repository, workspaceId,
assignment. Supervisor/Lead thêm inventory `profiles`/`providers`; Peer thêm
`providers` và `route: {optionId, catalogSha256}` lấy từ `routes`. Có thể kèm
profiles khi chuẩn bị Peer, nhưng chúng không thay thế pool. Hai trường tùy
chọn nữa, áp dụng cho cả `prepare-handoff`:

- `inventoryFile`: đường dẫn tuyệt đối tới JSON object có
  `providers`/`profiles`; các mảng này chỉ điền trường request chưa inline —
  mảng inline tường minh (kể cả `[]`) luôn thắng. Tạo file bằng
  `inventory --paseo-home <absolute-home>` (bên dưới); dưới managed runtime
  providers của nó mang `provenance: "configured"` và bị từ chối làm bằng
  chứng launch — truyền output `list_providers` live từ cùng daemon inline
  vào `providers` thay thế.
- `assignmentFile`: đường dẫn tuyệt đối tới file assignment đầy đủ (phải tồn
  tại, là file thường và đọc được). Prompt giữ `assignment` làm brief ngắn và
  thêm dòng `Assignment file: <path> — read it first; it is authoritative
  for scope details.`; nội dung file không được inline.

Option quyết định nguyên bundle và map sang
`slp-pi-peer`/`slp-codex-peer`/`slp-devin-peer`/`slp-claude-peer`; model chứa `/` được giữ
nguyên. `binding` tường minh không kèm profiles chỉ hỗ trợ Supervisor/Lead
khi được Human cho phép. Peer luôn phải chọn option trong pool, kể cả handoff
và recovery.

Plan cũng surface mode dự kiến của spawn — `modeId` top-level phản chiếu
`create.settings.modeId`, kèm `warnings` khi binding thiếu — và hai payload
locator được mang bên trong `create.initialPrompt` (bản carrier ở prompt chỉ
bị bỏ khi target là canonical role wrapper đã live-verify — wrapper inject
lúc session entry) để seat được spawn thực
sự nhận được: `spawnKit`, danh sách signature approximate của Paseo MCP tools
theo role (verify với `mcp_list_tools` live), và `orientation`, các locator
policy-byte (`path`, `bytes`, `sha256`, hoặc `missing` cho file receipt đã
declare nhưng absent trên disk; tập locator derive từ install receipt nên
document chỉ có ở source không bao giờ được declare). Chỉ locators — việc
diễn giải vẫn thuộc seat.

`prepare-handoff <request.json>` thêm snapshot và handoff vào
create_agent arguments; xem
[ví dụ handoff](examples/provider-handoff.request.json). Hai lệnh chỉ chuẩn
bị arguments; Supervisor/Lead dùng Paseo để thực sự tạo agent.

### `inventory` / `agents`

Hai lệnh read-only hỗ trợ discovery, chạy được offline (không cần daemon hay
`paseo` trên PATH):

```bash
node "$SLP_RT/bin/slp.mjs" inventory [--paseo-home /absolute/paseo-home]
node "$SLP_RT/bin/slp.mjs" agents [--paseo-home /absolute/paseo-home]
```

`inventory` in `{providers, profiles, source}` đúng shape `prepare` nhận —
pipeline dự kiến là `inventory --paseo-home <absolute-home> > inventory.json`,
rồi `"inventoryFile": "/absolute/path/to/inventory.json"` trong request (xem
[`prepare`](#prepare--prepare-handoff) ở trên). Lệnh chỉ gọi `paseo provider
ls --json` khi `paseo.pid` của home được chỉ định là tiến trình đang sống;
không thì đọc `agents.providers` trong `config.json` của chính home đó —
không bao giờ lấy providers của daemon khác và không tạo thư mục. Dưới
managed runtime (`SLP_MANAGED_RUNTIME=1`) listing qua CLI không bao giờ được
gọi và mọi provider đều mang nhãn `provenance: "configured"` — config tĩnh,
bị từ chối làm bằng chứng launch. Dù theo đường nào, inventory chỉ chứng minh
độ đầy đủ của cấu hình, không phải sức khỏe provider; một entry được liệt kê
có thể đã stale và không phải dấu readiness. Providers live được chuẩn hóa thành `{id, enabled,
status}` (`enabled` có thể null với trạng thái không nhận diện được), còn
config cho `{id, enabled, extends}`; profiles luôn đọc từ
`daemon.agentProfiles`. Trên host nhiều daemon, listing live phản ánh daemon
mà `paseo` CLI kết nối tới. `agents` liệt kê `<home>/agents/*/<id>.json`
thành `{id, title, provider, cwd, workspaceId, status, lastActivityAt,
nativeHandle, attach}`; `attach` là gợi ý `cd <cwd> && devin -r <nativeHandle>` đã
shell-quote cho provider devin có handle. Vì `paseo inspect`/`ls` không trả
`persistence.nativeHandle`, lệnh này đọc persistence của daemon — chi tiết
host best-effort, không phải contract.

### `snapshot`

`snapshot <repo>` ghi nhận work snapshot gồm HEAD, đường dẫn
tracked/untracked không bị ignore, nội dung, symlink, permission mode và
deleted marker. Thư mục untracked là root của một repo Git lồng nhau được
snapshot đệ quy và ghi dưới `nested` (mỗi sub-repo có `{path, head, sha256,
files}` riêng và có thể mang `nested` của chính nó, tính vào sha256 tổng).
Gitlink submodule đã stage (mode 160000) và thư mục được liệt kê mà không
phải repo vẫn không được hỗ trợ.

### `materialize`

`.paseo-slp/` là local state bị gitignore chứa absolute path, nên worktree
mới thiếu hẳn protocol và catalog. `materialize` clone chúng từ một checkout
có sẵn:

```bash
node "$SLP_RT/bin/slp.mjs" materialize /absolute/target-repo --from /absolute/source-repo
# mặc định dry-run; thêm --apply để ghi
```

Lệnh chỉ copy `.paseo-slp/workspace-protocol.md` và
`.paseo-slp/slp-routing.json` (đã validate) — `notebook.md` là state do
Supervisor sở hữu và không bao giờ được copy. Absolute path nằm dưới source
root trong YAML frontmatter của protocol được rebase sang target root (path
anh em dài hơn kiểu `<source>-old` không khớp boundary nên giữ nguyên). Như
`init`, file đã tồn tại ở target được preserve chứ không ghi đè; mỗi file
báo `preserved`/`applied`, kèm `sha256` cho file sẽ ghi. Entry protocol còn
báo `rebased`, và bản copy ghi ra mà không tìm thấy source-root path nào sẽ
mang field `warning` thay vì lặng lẽ giữ path cũ. Không có fallback về
catalog user-scope hay template — source checkout là tường minh.

### `monitor`

`monitor` là scan tín hiệu on-demand cho Supervisor/Lead quan sát — một lần
gọi là một lần scan, không phải daemon, và chỉ emit candidate chứ không ra
verdict:

```bash
node "$SLP_RT/bin/slp.mjs" monitor /absolute/request.json
```

Request khai `agents` (`id`, `cwd` tùy chọn — fallback về `cwd` trong state
file — và `scope` tùy chọn là danh sách prefix/glob), cùng các trường tùy
chọn `paseoHome` (mặc định `$PASEO_HOME`/`~/.paseo`), `devinSessionsDb`
(absolute path, opt-in), `thresholds` (`idleMinutes`, `churnScans`;
`toolWindow` mặc định 20, `toolShare` mặc định 0.8 và `cadenceEdits` mặc
định 3 cho các signal sessions-db), subset `signals` và đường dẫn checkpoint
`stateFile`. Evidence đến từ `<paseoHome>/agents/*/<id>.json` và `git
status`/`git log` trong từng `cwd`; `cwd` thiếu hoặc không phải repo được
ghi thành evidence gap thay vì crash. Có `devinSessionsDb` thì nó probe
sessions db của devin CLI (read-only; thường
`~/.local/share/devin/cli/sessions.db`) cho các agent devin-provider; db
thiếu hoặc không đọc được là gap entry, không phải lỗi. Các loại signal:
`attention` (chỉ khi
`requiresAttention` là true — `attentionReason` cũ chỉ là evidence),
`follow-up-round` (user bump mà không có commit xen giữa), `idle-dirty`,
`scope-drift`, `test-mirror`, `file-churn` (cùng một path dirty bị sửa
lại qua các scan, theo dõi bằng mtime), `tool-mix` và `correction-cadence`
(candidate từ sessions-db, yêu cầu `devinSessionsDb`). Có `stateFile` thì chỉ fingerprint
mới được emit và checkpoint — write duy nhất của lệnh — được ghi lại atomic
mỗi run; không có thì scan gắn cờ `stateless` và emit mọi thứ phát hiện
được. Output rendered của `paseo logs` không bao giờ được parse;
`get_agent_activity` chỉ trả tail đã curated, giới hạn `limit` (session dài
bị truncate vào overflow file) — structured timeline đầy đủ vẫn là host gap
đã ghi nhận.

### `notebook`

`notebook` định vị governance notebook của một repository khi run đang hoạt
động nằm ở checkout khác — record của Supervisor trong worktree nằm ở
`<checkout-của-nó>/.paseo-slp/notebook.md`, không nhìn thấy từ main checkout:

```bash
node "$SLP_RT/bin/slp.mjs" notebook /absolute/repository [--paseo-home /absolute/paseo-home]
```

Lệnh resolve git common dir của repository — thuộc tính liên kết một
worktree về repository của nó — rồi liệt kê các Supervisor agent (provider
chứa `supervisor`, hoặc state file có title `Supervisor`) mà `cwd` chia sẻ
common dir đó. Output chỉ là candidate: `{agentId, title, status, cwd,
lastActivityAt, notebook, notebookExists}` sắp theo activity mới nhất, kèm
`gaps` cho các cwd agent lỗi git probe. Read-only — không copy, merge hay
sửa nội dung notebook, và không chọn candidate nào là authoritative; vị trí
governance vẫn là per-checkout.

## Kiểm thử

```bash
npm test
npm run check
```

Kiểm tra local gồm transaction/recovery của manager, materializer, sinh
launch-shim, bảo toàn cấu hình, protocol và adapter stdio; chúng không
chứng minh role tuân thủ operating guide. Plugin đã được kiểm chứng live
trên daemon Paseo 0.8.0 thật: cài qua Git source, surface quản lý, các RPC
activate/deactivate/reconcile, patch provider/profile, từ chối collision và
drift, cùng phân loại recovery — xem `.local-checks/` cho evidence ledger.
Role là instruction hành vi, không phải filesystem/MCP sandbox. Transport
hỗ trợ Codex, Pi, Devin và Claude; routing, adapter và handoff có kiểm tra
local. Live provider switching, heartbeat, council và toàn bộ E2E manifest
chưa được nghiệm thu E2E. Capability và đường nạp policy được ghi trong
bảng trace bên dưới.

## E2E

Để chạy dogfood từ một session mở trên **source checkout** này, yêu cầu:
**"chạy E2E toàn bộ package"**. [Skill E2E](skills/paseo-slp-e2e/SKILL.md)
hướng dẫn session đi qua toàn bộ [scenario manifest](e2e/scenarios.mjs), dùng
các session con trên Paseo thật, thu evidence, review độc lập và cleanup, rồi
trả một báo cáo chung. Quyền, host và budget đã cấp được tái sử dụng; nhánh
thiếu điều kiện ghi BLOCKED. `npm run e2e` chỉ in entrypoint cho session
(exit 2, chưa chạy live); các subcommand hỗ trợ fixture/evidence/verdict được
mô tả trong [hướng dẫn E2E](e2e/README.md). Bộ hỗ trợ này chưa có live
acceptance; việc thêm entrypoint không đổi các trạng thái E2E chưa được kiểm
chứng ở trên.

Để chạy một scenario `basic-*`, cấu hình hai profile Supervisor/Lead
và pool Peer của fixture theo family tương ứng. Coordinator chuẩn bị
fixture/protocol, pool và baseline; Supervisor tạo Lead theo saved profile,
Lead tự chọn Peer option. Không có confirmer trước launch cho basic. U2 đối
chiếu profiles cho Supervisor/Lead và option/hash cho Peer. `mixed-peer` kiểm
tra pool có cả Codex/Pi, không cần thêm saved profile hay ép family của Lead
theo mỗi Peer. Các scenario ngoài scope giữ NOT_RUN.

Đường CLI offline vẫn có: `prepare <request.json>` (từ `bin/slp.mjs` của
source checkout) xuất create_agent arguments có role envelope, và
`install <dir> --apply` chỉ stage package — xem
[docs/reports/legacy-install.md](docs/reports/legacy-install.md). Đường này không đăng ký
profile hay tự tạo agent.

## Tài liệu

Cách hoạt động:

- [Kiến trúc plugin](docs/architecture.md) — role model, plugin bổ sung gì
  cho Paseo, kênh inject ẩn, vòng delegation
- [File map và contract](docs/contract.md)
- [Hướng dẫn cài đặt cho agent](docs/agent-guide.md)
- [Checklist nghiệm thu độc lập](docs/review-checklist.md)

Spec implement:

- [Plugin implementation spec](docs/spec/paseo-plugin-implementation.md)
- [Plugin feasibility audit](docs/spec/paseo-plugin-feasibility.md)
- [Settings-driven providers + hook injection](docs/spec/settings-driven-providers.md) —
  sketch hướng post-v1

Báo cáo và điều tra:

- [Trace guide → policy, procedure và protocol](docs/reports/guide-coverage.md)
- [Installer standalone cũ](docs/reports/legacy-install.md)

Cơ chế host tham chiếu:
[custom providers](https://paseo.sh/docs/custom-providers.md),
[agent profiles](https://paseo.sh/docs/agent-profiles.md),
[Codex app-server](https://learn.chatgpt.com/docs/app-server#threads).
