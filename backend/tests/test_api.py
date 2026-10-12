import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import fastapi_app
from app.db.seed import seed_database
from sqlalchemy import delete, select, update
from app.db.postgres import async_session_maker
from app.models.map_entity import MapEntity
from app.models.soldier import Soldier
from app.models.threat import Threat
from app.models.user import User


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    # 1. Upsert default system seed users/soldiers safely without deleting user-created accounts
    await seed_database()

    # 2. Clean up only temporary test records created during test runs
    async with async_session_maker() as session:
        test_usernames = [
            "squad_test_eod",
            "center_south_test",
            "center_empty",
            "squad_dup_internal",
            "squad_dup_existing",
        ]
        test_soldier_ids = ["9999001", "9999002", "8888001", "7777001"]
        test_threat_names = [
            "Test Minefield",
            "Operator Reported Hostile Drone",
        ]

        # Reset default demo threats to active / unassigned
        await session.execute(
            update(Threat)
            .where(Threat.name.in_(["IED Blockade Route 4", "Hostile Recon Drone"]))
            .values(engagement_status="unassigned", assigned_to_id=None, status="active")
        )

        # Remove test threats
        await session.execute(delete(Threat).where(Threat.name.in_(test_threat_names)))

        # Remove test users and their map entities
        users_stmt = select(User).where(User.username.in_(test_usernames))
        test_users = (await session.execute(users_stmt)).scalars().all()
        for u in test_users:
            await session.execute(delete(MapEntity).where(MapEntity.id == u.id))
            await session.execute(delete(User).where(User.id == u.id))

        # Remove test soldiers
        await session.execute(delete(Soldier).where(Soldier.id.in_(test_soldier_ids)))

        await session.commit()


@pytest.mark.asyncio
async def test_auth_login_success():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["role"] == "MainCommandCenter"
        assert data["user"]["area"] == "Global"


@pytest.mark.asyncio
async def test_auth_login_invalid_credentials():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong_password"},
        )
        assert resp.status_code == 401
        data = resp.json()
        assert data["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_auth_me_and_refresh():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "command_north", "password": "command123"},
        )
        assert login_res.status_code == 200
        tokens = login_res.json()
        token = tokens["access_token"]
        refresh_token = tokens["refresh_token"]

        # 2. Get Me
        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["username"] == "command_north"
        assert me_data["area"] == "North"

        # 3. Refresh Token
        ref_res = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert ref_res.status_code == 200
        ref_data = ref_res.json()
        assert "access_token" in ref_data
        assert "refresh_token" in ref_data


@pytest.mark.asyncio
async def test_admin_users_management():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        admin_token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}

        # 1. List users
        list_res = await client.get("/api/v1/admin/users", headers=headers)
        assert list_res.status_code == 200
        users = list_res.json()
        assert len(users) >= 7

        # 2. Create new SapperSquad (auto promoted by sapper in soldiers)
        create_payload = {
            "username": "squad_test_eod",
            "password": "password123",
            "role": "Squad",  # passed Squad, should auto-promote to SapperSquad
            "name": "Test Engineering Unit",
            "lat": 32.5000,
            "lon": 34.9000,
            "soldiers": [
                {"id": "9999001", "name": "Test Soldier 1", "role": "rifleman"},
                {"id": "9999002", "name": "Test Soldier 2", "role": "sapper"},
            ],
        }
        create_res = await client.post("/api/v1/admin/users", json=create_payload, headers=headers)
        assert create_res.status_code == 201
        created_user = create_res.json()
        assert created_user["role"] == "SapperSquad"
        assert created_user["area"] == "Center"
        new_user_id = created_user["id"]

        # 3. Soft-deactivate unit
        patch_res = await client.patch(
            f"/api/v1/admin/users/{new_user_id}/status",
            json={"status": "inactive"},
            headers=headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["status"] == "inactive"


@pytest.mark.asyncio
async def test_threats_rbac_and_lifecycle():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as SapperSquad (squad_paratroopers)
        sapper_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_paratroopers", "password": "squad123"},
        )
        sapper_token = sapper_res.json()["access_token"]
        sapper_headers = {"Authorization": f"Bearer {sapper_token}"}

        # Login as Regular Squad (squad_golani)
        golani_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_golani", "password": "squad123"},
        )
        golani_token = golani_res.json()["access_token"]
        golani_headers = {"Authorization": f"Bearer {golani_token}"}

        # 1. Create explosive threat
        threat_payload = {
            "name": "Test Minefield",
            "threat_type": "explosive",
            "type": "immovable",
            "severity_level": "high",
            "lat": 32.0860,
            "lon": 34.7830,
            "radius": 150.0,
        }
        create_res = await client.post("/api/v1/threats", json=threat_payload, headers=sapper_headers)
        assert create_res.status_code == 201
        threat_id = create_res.json()["id"]

        # 2. Regular squad attempts to take responsibility for explosive threat -> FORBIDDEN
        golani_take_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=golani_headers,
        )
        assert golani_take_res.status_code == 403

        # 3. Sapper squad takes responsibility -> 200 OK
        sapper_take_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=sapper_headers,
        )
        assert sapper_take_res.status_code == 200
        assert sapper_take_res.json()["engagement_status"] == "in_progress"

        # 4. Another attempt to take responsibility when already assigned -> 409 CONFLICT
        conflict_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "in_progress"},
            headers=sapper_headers,
        )
        assert conflict_res.status_code == 409
        assert conflict_res.json()["error"]["code"] == "THREAT_ALREADY_ASSIGNED"

        # 5. Attempt to reposition immovable threat -> 400 Bad Request
        move_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"lat": 32.0870, "lon": 34.7840},
            headers=sapper_headers,
        )
        assert move_res.status_code == 400

        # 6. Resolve threat by SapperSquad -> 200 OK
        resolve_res = await client.patch(
            f"/api/v1/threats/{threat_id}",
            json={"engagement_status": "resolved"},
            headers=sapper_headers,
        )
        assert resolve_res.status_code == 200
        assert resolve_res.json()["engagement_status"] == "resolved"


@pytest.mark.asyncio
async def test_map_snapshot():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin (Global visibility)
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        snap_res = await client.get("/api/v1/map/snapshot", headers=headers)
        assert snap_res.status_code == 200
        snapshot = snap_res.json()
        assert "squads" in snapshot
        assert "threats" in snapshot
        assert len(snapshot["squads"]) >= 2
        # Ensure radars and command centers are NOT exposed in squad locations
        for s in snapshot["squads"]:
            assert s["role"] in ["Squad", "SapperSquad"]
            assert s["role"] not in ["Radar", "AreaCommandCenter", "MainCommandCenter"]
        assert len(snapshot["threats"]) >= 2


@pytest.mark.asyncio
async def test_admin_cannot_self_deactivate():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        admin_data = login_res.json()
        admin_id = admin_data["user"]["id"]
        headers = {"Authorization": f"Bearer {admin_data['access_token']}"}

        deactivate_res = await client.patch(
            f"/api/v1/admin/users/{admin_id}/status",
            json={"status": "inactive"},
            headers=headers,
        )
        assert deactivate_res.status_code == 400
        assert deactivate_res.json()["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.asyncio
async def test_soldier_duplicate_id_protection():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        # 1. Duplicate within same payload
        payload_internal_dup = {
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
        }
        res_dup = await client.post("/api/v1/admin/users", json=payload_internal_dup, headers=headers)
        assert res_dup.status_code == 422

        # 2. Duplicate with already existing soldier (e.g. 1000001 from Golani)
        payload_existing_dup = {
            "username": "squad_dup_existing",
            "password": "password123",
            "role": "Squad",
            "name": "Dup Existing Squad",
            "lat": 32.2,
            "lon": 34.8,
            "soldiers": [
                {"id": "1000001", "name": "Existing Soldier", "role": "rifleman"},
            ],
        }
        res_existing = await client.post("/api/v1/admin/users", json=payload_existing_dup, headers=headers)
        assert res_existing.status_code == 409
        assert res_existing.json()["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_drone_altitude_rbac_protection():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as regular squad (squad_golani)
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"username": "squad_golani", "password": "squad123"},
        )
        headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        # Query threats to find the demo drone
        threats_res = await client.get("/api/v1/threats", headers=headers)
        assert threats_res.status_code == 200

        # Login as radar to get demo drone id
        radar_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "radar_post_1", "password": "radar123"},
        )
        radar_headers = {"Authorization": f"Bearer {radar_login.json()['access_token']}"}
        drone_res = await client.get("/api/v1/threats?threat_type=drone", headers=radar_headers)
        assert drone_res.status_code == 200
        drones = drone_res.json()
        assert len(drones) >= 1
        drone_id = drones[0]["id"]

        # Regular squad attempts to update drone altitude -> FORBIDDEN
        patch_res = await client.patch(
            f"/api/v1/threats/{drone_id}",
            json={"altitude": 600.0},
            headers=headers,
        )
        assert patch_res.status_code == 403
        assert patch_res.json()["error"]["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_single_active_session_and_reset():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. First login succeeds
        login_1 = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login_1.status_code == 200
        admin_token = login_1.json()["access_token"]
        headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Concurrent login with same user without logout is rejected (409 Conflict)
        login_2 = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login_2.status_code == 409
        assert login_2.json()["error"]["code"] == "SESSION_ACTIVE"

        # 3. Explicit logout frees session
        logout_res = await client.post("/api/v1/auth/logout", headers=headers)
        assert logout_res.status_code == 200

        # 4. Login now succeeds again
        login_3 = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert login_3.status_code == 200
        admin_token_2 = login_3.json()["access_token"]
        headers_2 = {"Authorization": f"Bearer {admin_token_2}"}

        # 5. Test public unauthenticated reset all sessions endpoint (from login screen)
        pub_reset = await client.post("/api/v1/auth/reset-all-sessions")
        assert pub_reset.status_code == 200
        assert "All active user sessions reset successfully" in pub_reset.json()["message"]

        # 6. Test admin reset all sessions endpoint
        reset_all = await client.post("/api/v1/admin/users/reset-all-sessions", headers=headers_2)
        assert reset_all.status_code == 200
        assert "All active user sessions reset" in reset_all.json()["message"]


@pytest.mark.asyncio
async def test_soldiers_crud_and_attribution():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

        # 1. Create soldier in registry
        soldier_payload = {
            "id": "7777001",
            "name": "Barak Raz",
            "role": "recon",
        }
        create_res = await client.post("/api/v1/admin/soldiers", json=soldier_payload, headers=headers)
        assert create_res.status_code == 201
        created_soldier = create_res.json()
        assert created_soldier["id"] == "7777001"
        assert created_soldier["name"] == "Barak Raz"

        # 2. Get soldier
        get_res = await client.get("/api/v1/admin/soldiers/7777001", headers=headers)
        assert get_res.status_code == 200
        assert get_res.json()["name"] == "Barak Raz"

        # 3. Update soldier
        patch_res = await client.patch(
            "/api/v1/admin/soldiers/7777001",
            json={"role": "commander"},
            headers=headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["role"] == "commander"

        # 4. List soldiers
        list_res = await client.get("/api/v1/admin/soldiers", headers=headers)
        assert list_res.status_code == 200
        soldiers = list_res.json()
        assert any(s["id"] == "7777001" for s in soldiers)

        # 5. Delete soldier
        del_res = await client.delete("/api/v1/admin/soldiers/7777001", headers=headers)
        assert del_res.status_code == 200

        # 6. Check threat attribution
        threats_res = await client.get("/api/v1/threats", headers=headers)
        assert threats_res.status_code == 200
        threats = threats_res.json()
        assert len(threats) >= 1
        first_threat = threats[0]
        assert "created_by_soldier_id" in first_threat
        assert "created_by_soldier_name" in first_threat
        assert "created_by_unit_name" in first_threat
        assert first_threat["created_by_unit_name"] is not None

        # 7. Create threat with explicit soldier attribution
        created_res = await client.post(
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
            headers=headers,
        )
        assert created_res.status_code == 201
        created_data = created_res.json()
        assert created_data["created_by_soldier_id"] == "1000001"
        assert created_data["created_by_soldier_name"] == "David Cohen"
        assert created_data["created_by_unit_name"] == "Main Command Center"


@pytest.mark.asyncio
async def test_command_center_soldier_assignment_and_unassigned():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

        # 1. Create an unassigned soldier in registry
        soldier_payload = {
            "id": "8888001",
            "name": "Yoni Net",
            "role": "communications",
        }
        create_soldier_res = await client.post("/api/v1/admin/soldiers", json=soldier_payload, headers=headers)
        assert create_soldier_res.status_code == 201

        # 2. Query unassigned soldiers list
        unassigned_res = await client.get("/api/v1/admin/soldiers/unassigned", headers=headers)
        assert unassigned_res.status_code == 200
        unassigned_list = unassigned_res.json()
        assert any(s["id"] == "8888001" for s in unassigned_list)

        # 3. Also query via query parameter ?unassigned=true
        param_res = await client.get("/api/v1/admin/soldiers?unassigned=true", headers=headers)
        assert param_res.status_code == 200
        assert any(s["id"] == "8888001" for s in param_res.json())

        # 4. Attempt to create AreaCommandCenter without any soldiers -> 422
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

        # 5. Create AreaCommandCenter assigning the unassigned soldier
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
        created_user = good_center.json()
        assert any(s["id"] == "8888001" for s in created_user.get("soldiers", []))

        # 6. Verify soldier is no longer in unassigned list
        unassigned_res_after = await client.get("/api/v1/admin/soldiers/unassigned", headers=headers)
        assert unassigned_res_after.status_code == 200
        assert not any(s["id"] == "8888001" for s in unassigned_res_after.json())


