import pytest
import pytest_asyncio
from app.db.postgres import async_session_maker
from app.db.seed import seed_database
from app.main import fastapi_app
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

TEST_USERNAMES = [
    "squad_test_eod",
    "center_south_test",
    "center_empty",
    "squad_dup_internal",
    "squad_dup_existing",
    "squad_auto_test",
]
TEST_SOLDIER_IDS = ["9999001", "9999002", "8888001", "7777001"]
TEST_THREAT_NAMES = [
    "Test Minefield",
    "Operator Reported Hostile Drone",
]


async def _cleanup_test_artifacts():
    async with async_session_maker() as session:
        await session.execute(
            update(Threat)
            .where(Threat.name.in_(["IED Blockade Route 4", "Hostile Recon Drone"]))
            .values(engagement_status="unassigned", assigned_to_id=None, status="active")
        )
        await session.execute(delete(Threat).where(Threat.name.in_(TEST_THREAT_NAMES)))

        users_stmt = select(User).where(User.username.in_(TEST_USERNAMES))
        test_users = (await session.execute(users_stmt)).scalars().all()
        for u in test_users:
            await session.execute(delete(MapEntity).where(MapEntity.id == u.id))
            await session.execute(delete(User).where(User.id == u.id))

        await session.execute(delete(Soldier).where(Soldier.id.in_(TEST_SOLDIER_IDS)))
        await session.commit()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_suite():
    """Initializes standard demo seed data once per test session."""
    await _cleanup_test_artifacts()
    await seed_database()
    yield
    await _cleanup_test_artifacts()


@pytest.mark.asyncio
async def test_auth_lifecycle():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Invalid credentials
        bad_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong_password"},
        )
        assert bad_login.status_code == 401
        assert bad_login.json()["error"]["code"] == "UNAUTHORIZED"

        # 2. Valid login & token attributes
        login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login.status_code == 200
        data = login.json()
        assert data["token_type"] == "bearer"
        assert data["user"]["role"] == "MainCommandCenter"
        assert data["user"]["area"] == "Global"
        token = data["access_token"]
        refresh_token = data["refresh_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. Verify /me and token refresh
        me_res = await client.get("/api/v1/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["username"] == "admin"

        ref_res = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert ref_res.status_code == 200
        assert "access_token" in ref_res.json()

        # 4. Concurrent login without logout triggers session lock
        dup_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert dup_login.status_code == 409
        assert dup_login.json()["error"]["code"] == "SESSION_ACTIVE"

        # 5. Explicit logout frees session
        logout_res = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout_res.status_code == 200

        # 6. Login succeeds after logout
        login_again = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login_again.status_code == 200
        token_again = login_again.json()["access_token"]

        # 7. Public & admin session resets
        pub_reset = await client.post("/api/v1/auth/reset-all-sessions")
        assert pub_reset.status_code == 200

        adm_reset = await client.post(
            "/api/v1/admin/users/reset-all-sessions",
            headers={"Authorization": f"Bearer {token_again}"},
        )
        assert adm_reset.status_code == 200


@pytest.mark.asyncio
async def test_admin_and_units_lifecycle():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Reset and login as Admin
        await client.post("/api/v1/auth/reset-all-sessions")
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        admin_id = login_res.json()["user"]["id"]

        # 1. List users
        users_res = await client.get("/api/v1/admin/users", headers=headers)
        assert users_res.status_code == 200
        assert len(users_res.json()) >= 7

        # 2. Cannot self-deactivate admin
        deact_res = await client.patch(
            f"/api/v1/admin/users/{admin_id}/status",
            json={"status": "inactive"},
            headers=headers,
        )
        assert deact_res.status_code == 400
        assert deact_res.json()["error"]["code"] == "INVALID_REQUEST"

        # 3. Duplicate soldier ID protections
        res_dup_internal = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "squad_dup_internal",
                "password": "password123",
                "role": "Squad",
                "name": "Dup Squad",
                "lat": 32.2,
                "lon": 34.8,
                "soldiers": [
                    {"id": "8888001", "name": "Soldier A", "role": "rifleman"},
                    {"id": "8888001", "name": "Soldier B", "role": "medic"},
                ],
            },
            headers=headers,
        )
        assert res_dup_internal.status_code == 422

        res_dup_existing = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "squad_dup_existing",
                "password": "password123",
                "role": "Squad",
                "name": "Dup Existing Squad",
                "lat": 32.2,
                "lon": 34.8,
                "soldiers": [{"id": "1000001", "name": "Existing Soldier", "role": "rifleman"}],
            },
            headers=headers,
        )
        assert res_dup_existing.status_code == 409

        # 4. Create new unit (auto-promoted to SapperSquad by sapper soldier)
        create_res = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "squad_test_eod",
                "password": "password123",
                "role": "Squad",
                "name": "Test Engineering Unit",
                "lat": 32.5000,
                "lon": 34.9000,
                "soldiers": [
                    {"id": "9999001", "name": "Test Soldier 1", "role": "rifleman"},
                    {"id": "9999002", "name": "Test Soldier 2", "role": "sapper"},
                ],
            },
            headers=headers,
        )
        assert create_res.status_code == 201
        new_unit = create_res.json()
        assert new_unit["role"] == "SapperSquad"
        assert new_unit["area"] == "Center"

        # 5. Soft-deactivate created unit
        status_res = await client.patch(
            f"/api/v1/admin/users/{new_unit['id']}/status",
            json={"status": "inactive"},
            headers=headers,
        )
        assert status_res.status_code == 200
        assert status_res.json()["status"] == "inactive"


@pytest.mark.asyncio
async def test_soldiers_and_command_centers():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/auth/reset-all-sessions")
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

        # 1. Soldier CRUD
        create_soldier = await client.post(
            "/api/v1/admin/soldiers",
            json={"id": "7777001", "name": "Barak Raz", "role": "recon"},
            headers=headers,
        )
        assert create_soldier.status_code == 201

        get_soldier = await client.get("/api/v1/admin/soldiers/7777001", headers=headers)
        assert get_soldier.status_code == 200
        assert get_soldier.json()["name"] == "Barak Raz"

        patch_soldier = await client.patch(
            "/api/v1/admin/soldiers/7777001",
            json={"role": "commander"},
            headers=headers,
        )
        assert patch_soldier.status_code == 200
        assert patch_soldier.json()["role"] == "commander"

        del_soldier = await client.delete("/api/v1/admin/soldiers/7777001", headers=headers)
        assert del_soldier.status_code == 200

        # 2. Create unassigned soldier and test retrieval
        soldier_payload = {"id": "8888001", "name": "Yoni Net", "role": "communications"}
        await client.post("/api/v1/admin/soldiers", json=soldier_payload, headers=headers)

        unassigned_res = await client.get("/api/v1/admin/soldiers/unassigned", headers=headers)
        assert unassigned_res.status_code == 200
        assert any(s["id"] == "8888001" for s in unassigned_res.json())

        param_res = await client.get("/api/v1/admin/soldiers?unassigned=true", headers=headers)
        assert param_res.status_code == 200
        assert any(s["id"] == "8888001" for s in param_res.json())

        # 3. AreaCommandCenter creation requires at least one soldier
        bad_center = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "center_empty",
                "name": "Southern Regional Command",
                "password": "password123",
                "role": "AreaCommandCenter",
                "area": "South",
                "lat": 31.25,
                "lon": 34.79,
            },
            headers=headers,
        )
        assert bad_center.status_code == 422
        assert "At least one soldier is required" in bad_center.json()["error"]["message"]

        # 4. Create AreaCommandCenter assigning unassigned soldier
        good_center = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "center_south_test",
                "name": "Southern Regional Command",
                "password": "password123",
                "role": "AreaCommandCenter",
                "area": "South",
                "lat": 31.25,
                "lon": 34.79,
                "soldier_ids": ["8888001"],
            },
            headers=headers,
        )
        assert good_center.status_code == 201
        assert any(s["id"] == "8888001" for s in good_center.json().get("soldiers", []))

        # 5. Verify soldier is no longer in unassigned list
        unassigned_after = await client.get("/api/v1/admin/soldiers/unassigned", headers=headers)
        assert unassigned_after.status_code == 200
        assert not any(s["id"] == "8888001" for s in unassigned_after.json())

        # 6. Auto-generate soldier ID and test unlinked soldiers endpoint
        auto_res = await client.post(
            "/api/v1/admin/soldiers",
            json={"name": "Auto Generated", "role": "Combat"},
            headers=headers,
        )
        assert auto_res.status_code == 201
        auto_soldier = auto_res.json()
        assert len(auto_soldier["id"]) == 7
        assert auto_soldier["id"].isdigit()

        unlinked_res = await client.get("/api/v1/admin/soldiers/unlinked", headers=headers)
        assert unlinked_res.status_code == 200
        assert any(s["id"] == auto_soldier["id"] for s in unlinked_res.json())

        # 7. Create Squad with omitted coordinates and auto-generated roster soldier
        field_res = await client.post(
            "/api/v1/admin/users",
            json={
                "username": "squad_auto_test",
                "name": "Auto Sector Squad",
                "password": "password123",
                "role": "Squad",
                "area": "North",
                "soldiers": [{"name": "Roster Alpha", "role": "Combat"}],
            },
            headers=headers,
        )
        assert field_res.status_code == 201
        field_data = field_res.json()
        assert field_data["lat"] is None
        assert field_data["lon"] is None
        assert field_data["area"] == "North"
        assert len(field_data["soldiers"]) == 1
        assert len(field_data["soldiers"][0]["id"]) == 7

        # 8. Test DELETE user endpoint
        del_res = await client.delete(f"/api/v1/admin/users/{field_data['id']}", headers=headers)
        assert del_res.status_code == 200
        assert "deleted successfully" in del_res.json()["message"]

        # Verify user is removed from user directory
        users_after = (await client.get("/api/v1/admin/users", headers=headers)).json()
        assert not any(u["id"] == field_data["id"] for u in users_after)

        # Clean up auto soldier
        await client.delete(f"/api/v1/admin/soldiers/{auto_soldier['id']}", headers=headers)


@pytest.mark.asyncio
async def test_threats_rbac_and_lifecycle():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/auth/reset-all-sessions")
        sapper_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_paratroopers", "password": "squad123"},
        )
        sapper_headers = {"Authorization": f"Bearer {sapper_res.json()['access_token']}"}

        golani_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_golani", "password": "squad123"},
        )
        golani_headers = {"Authorization": f"Bearer {golani_res.json()['access_token']}"}

        # 1. Create explosive threat
        create_res = await client.post(
            "/api/v1/threats",
            json={
                "name": "Test Minefield",
                "threat_type": "explosive",
                "type": "immovable",
                "severity_level": "high",
                "lat": 32.0860,
                "lon": 34.7830,
                "radius": 150.0,
            },
            headers=sapper_headers,
        )
        assert create_res.status_code == 201
        threat_id = create_res.json()["id"]

        # 2. Regular squad cannot take responsibility for explosive threat
        golani_take = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=golani_headers,
        )
        assert golani_take.status_code == 403

        # 3. Sapper squad takes responsibility
        sapper_take = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=sapper_headers,
        )
        assert sapper_take.status_code == 200
        assert sapper_take.json()["engagement_status"] == "in_progress"

        # 4. Conflict when already assigned
        conflict_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=sapper_headers,
        )
        assert conflict_res.status_code == 409
        assert conflict_res.json()["error"]["code"] == "THREAT_ALREADY_ASSIGNED"

        # 5. Cannot reposition immovable threat
        move_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"lat": 32.0870, "lon": 34.7840},
            headers=sapper_headers,
        )
        assert move_res.status_code == 400

        # 6. Sapper resolves threat
        resolve_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "resolved"},
            headers=sapper_headers,
        )
        assert resolve_res.status_code == 200
        assert resolve_res.json()["engagement_status"] == "resolved"


@pytest.mark.asyncio
async def test_drone_tactical_operations():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/auth/reset-all-sessions")
        # Logins
        golani_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_golani", "password": "squad123"},
        )
        golani_headers = {"Authorization": f"Bearer {golani_res.json()['access_token']}"}

        admin_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        admin_headers = {"Authorization": f"Bearer {admin_res.json()['access_token']}"}

        radar_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "radar_post_1", "password": "radar123"},
        )
        radar_headers = {"Authorization": f"Bearer {radar_res.json()['access_token']}"}

        # 1. Fetch demo drone
        drones_res = await client.get("/api/v1/threats?threat_type=drone", headers=radar_headers)
        assert drones_res.status_code == 200
        drones = drones_res.json()
        assert len(drones) >= 1
        drone_id = drones[0]["id"]

        # 2. Regular squad forbidden from modifying altitude or resolving drone
        alt_forbid = await client.patch(
            f"/api/v1/threats/{drone_id}",
            json={"altitude": 600.0},
            headers=golani_headers,
        )
        assert alt_forbid.status_code == 403

        resolve_forbid = await client.patch(
            f"/api/v1/threats/{drone_id}",
            json={"engagement_status": "resolved"},
            headers=golani_headers,
        )
        assert resolve_forbid.status_code == 403

        # 3. Admin can update drone altitude
        admin_alt = await client.patch(
            f"/api/v1/threats/{drone_id}",
            json={"altitude": 550.0},
            headers=admin_headers,
        )
        assert admin_alt.status_code == 200
        assert admin_alt.json()["altitude"] == 550.0

        # 4. Admin shoots down / resolves drone (status inactive, engagement resolved)
        admin_shootdown = await client.patch(
            f"/api/v1/threats/{drone_id}",
            json={"engagement_status": "resolved"},
            headers=admin_headers,
        )
        assert admin_shootdown.status_code == 200
        assert admin_shootdown.json()["engagement_status"] == "resolved"
        assert admin_shootdown.json()["status"] == "inactive"

        # 5. Destroyed drone disappears completely from tactical map snapshot
        snap_res = await client.get("/api/v1/map/snapshot", headers=admin_headers)
        assert snap_res.status_code == 200
        active_ids = [t["id"] for t in snap_res.json()["threats"]]
        assert drone_id not in active_ids

        # 6. Create threat with explicit soldier attribution
        created_threat = await client.post(
            "/api/v1/threats",
            json={
                "name": "Operator Reported Hostile Drone",
                "threat_type": "drone",
                "severity_level": "critical",
                "lat": 32.0850,
                "lon": 34.7850,
                "altitude": 180.0,
                "soldier_id": "1000001",
            },
            headers=admin_headers,
        )
        assert created_threat.status_code == 201
        data = created_threat.json()
        assert data["created_by_soldier_id"] == "1000001"
        assert data["created_by_soldier_name"] == "David Cohen"
        assert data["created_by_unit_name"] == "Main Command Center"


@pytest.mark.asyncio
async def test_tactical_map_snapshot():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/auth/reset-all-sessions")
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        snap_res = await client.get("/api/v1/map/snapshot", headers=headers)
        assert snap_res.status_code == 200
        snapshot = snap_res.json()
        assert "squads" in snapshot
        assert "threats" in snapshot
        assert len(snapshot["squads"]) >= 2

        # Verify only squad field units are exposed as squad locations (no commands or radars)
        for s in snapshot["squads"]:
            assert s["role"] in ["Squad", "SapperSquad"]
            assert s["role"] not in ["Radar", "AreaCommandCenter", "MainCommandCenter"]
