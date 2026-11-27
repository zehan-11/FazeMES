package cn.iocoder.yudao.module.mes.service.face;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;

/** Supply a dedicated PostgreSQL database with the migration and a non-owner RLS role. */
@EnabledIfEnvironmentVariable(named="FAZE_FACE_TEST_PG", matches="jdbc:postgresql:.+")
class FaceVectorStoreIT {
    private final FaceVectorStore store = new FaceVectorStore(System.getenv("FAZE_FACE_TEST_PG"),
            "fazemes_face_app", System.getenv().getOrDefault("FAZE_FACE_TEST_PASSWORD", ""));

    private static float[] sample(double cosine) {
        float[] x = new float[128];
        x[0] = (float) cosine;
        x[1] = (float) Math.sqrt(1 - cosine * cosine);
        return x;
    }

    @Test
    void comparesExactScopedSamplesAndDeletesOnlyTheRequestedVersion() {
        UUID active = UUID.randomUUID(), old = UUID.randomUUID();
        float[] probe = sample(1);
        try {
            store.write(101, 21, active, List.of(sample(-1), sample(.6)), () -> {});
            store.write(101, 22, active, List.of(probe), () -> {});
            store.write(102, 21, active, List.of(probe), () -> {});
            store.write(101, 21, old, List.of(probe), () -> {});
            assertEquals(MesFaceAuthService.similarity(probe, sample(.6)), store.similarity(101,21,active,2,probe), 1e-6);
            assertEquals(-1, store.similarity(101,21,active,1,probe)); // incomplete/incorrect manifest
            store.delete(101,21,active);
            store.delete(101,21,active);
            assertEquals(-1, store.similarity(101,21,active,2,probe));
            assertEquals(1, store.similarity(101,22,active,1,probe), 1e-6);
            assertEquals(1, store.similarity(102,21,active,1,probe), 1e-6);
            assertEquals(1, store.similarity(101,21,old,1,probe), 1e-6);
        } finally {
            store.delete(101,21,active);
            store.delete(101,22,active);
            store.delete(102,21,active);
            store.delete(101,21,old);
        }
    }

    @Test
    void rowSecurityFiltersUnscopedQueriesAndRejectsWritesToOtherAccounts() throws Exception {
        UUID version=UUID.randomUUID();
        try {
            store.write(104,24,version,List.of(sample(1)), () -> {});
            store.write(105,24,version,List.of(sample(1)), () -> {});
            try (var c=java.sql.DriverManager.getConnection(System.getenv("FAZE_FACE_TEST_PG"),"fazemes_face_app",
                    System.getenv().getOrDefault("FAZE_FACE_TEST_PASSWORD",""));
                 var sql=c.createStatement()) {
                c.setAutoCommit(false);
                String query="SELECT COUNT(*) FROM mes_face_sample WHERE template_version='"+version+"'";
                try (var rs=sql.executeQuery(query)) { rs.next(); assertEquals(0,rs.getInt(1)); }
                sql.execute("SELECT set_config('mes.tenant_id','104',true),set_config('mes.user_id','24',true)");
                try (var rs=sql.executeQuery(query)) { rs.next(); assertEquals(1,rs.getInt(1)); }
                var denied=assertThrows(java.sql.SQLException.class,()->sql.executeUpdate("""
                        INSERT INTO mes_face_sample SELECT 105,user_id,template_version,2,model_version,embedding
                        FROM mes_face_sample WHERE template_version='"""+version+"'"));
                assertEquals("42501",denied.getSQLState());
                c.rollback();
            }
        } finally {
            store.delete(104,24,version);
            store.delete(105,24,version);
        }
    }

    @Test
    void agreesWithNormalizedDotProductOnBothSidesOfAcceptanceThreshold() {
        for (double cosine : new double[]{1, .541, .539, 0, -1}) {
            UUID version = UUID.randomUUID();
            float[] probe = sample(1), ref = sample(cosine);
            try {
                store.write(103, 23, version, List.of(ref), () -> {});
                double pg = store.similarity(103,23,version,1,probe);
                double java = MesFaceAuthService.similarity(probe, ref);
                assertEquals(java, pg, 1e-6);
                assertEquals(java >= .54, pg >= .54);
                System.out.printf("synthetic expected %.3f: Java %.6f, PostgreSQL %.6f%n", cosine, java, pg);
            } finally {
                store.delete(103,23,version);
            }
        }
    }
}
