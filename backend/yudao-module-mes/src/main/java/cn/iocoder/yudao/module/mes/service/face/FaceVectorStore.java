package cn.iocoder.yudao.module.mes.service.face;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.sql.*;
import java.util.*;

/** A separate PostgreSQL transaction; never enlist this connection in MySQL's transaction manager. */
@Component
public class FaceVectorStore {
    static final String MODEL = "yunet-2023mar+sface-2021dec";
    private final String url;
    private final Properties connection = new Properties();

    public FaceVectorStore(@Value("${mes.face-auth.vector.url:}") String url,
                           @Value("${mes.face-auth.vector.user:fazemes_face_app}") String user,
                           @Value("${mes.face-auth.vector.password:}") String password) {
        this.url = url;
        connection.setProperty("user", user);
        connection.setProperty("password", password);
        connection.setProperty("connectTimeout", "3");
        connection.setProperty("socketTimeout", "6");
        connection.setProperty("logServerErrorDetail", "false");
    }

    private interface Operation<T> { T run(Connection c) throws SQLException; }

    private <T> T scoped(long tenant, long user, Operation<T> operation) {
        if (!url.startsWith("jdbc:postgresql:")) throw new IllegalStateException("Face vector store unavailable");
        try (Connection c = DriverManager.getConnection(url, connection)) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement scope = c.prepareStatement(
                        "SELECT set_config('mes.tenant_id', ?, true), set_config('mes.user_id', ?, true)")) {
                    scope.setString(1, Long.toString(tenant));
                    scope.setString(2, Long.toString(user));
                    scope.execute();
                }
                T result = operation.run(c);
                c.commit();
                return result;
            } catch (SQLException | RuntimeException error) {
                c.rollback();
                throw error;
            }
        } catch (SQLException error) {
            // PostgreSQL error details may include bind values. Keep them out of application logs.
            throw new IllegalStateException("Face vector store unavailable");
        }
    }

    boolean ready() {
        try {
            return scoped(0, 0, c -> {
                try (PreparedStatement query = c.prepareStatement("SELECT embedding FROM mes_face_sample WHERE false")) {
                    query.executeQuery().close();
                    return true;
                }
            });
        } catch (IllegalStateException unavailable) {
            return false;
        }
    }

    // Serializes an uncertain PG commit with physical deletion after a lost MySQL connection.
    private void lockVersion(Connection c, UUID version) throws SQLException {
        try (PreparedStatement lock = c.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
            lock.setLong(1, version.getMostSignificantBits() ^ version.getLeastSignificantBits());
            lock.execute();
        }
    }

    void write(long tenant, long user, UUID version, List<float[]> samples, Runnable confirmReservation) {
        if (samples.isEmpty() || samples.size() > 3) throw new IllegalArgumentException("Invalid sample count");
        scoped(tenant, user, c -> {
            lockVersion(c, version);
            confirmReservation.run();
            try (PreparedStatement insert = c.prepareStatement("""
                    INSERT INTO mes_face_sample(tenant_id,user_id,template_version,sample_no,model_version,embedding)
                    VALUES (?,?,?,?,?,CAST(? AS vector(128)))""")) {
                int number = 0;
                for (float[] sample : samples) {
                    FaceTemplateCipher.validate(sample);
                    insert.setLong(1, tenant);
                    insert.setLong(2, user);
                    insert.setObject(3, version);
                    insert.setInt(4, ++number);
                    insert.setString(5, MODEL);
                    insert.setString(6, Arrays.toString(sample));
                    insert.addBatch();
                }
                insert.executeBatch();
            }
            return null;
        });
    }

    double similarity(long tenant, long user, UUID version, int sampleCount, float[] probe) {
        FaceTemplateCipher.validate(probe);
        return scoped(tenant, user, c -> {
            try (PreparedStatement query = c.prepareStatement("""
                    SELECT COUNT(*), MAX(1.0 - (embedding <=> CAST(? AS vector(128))))
                    FROM mes_face_sample WHERE tenant_id=? AND user_id=? AND template_version=? AND model_version=?""")) {
                query.setString(1, Arrays.toString(probe));
                query.setLong(2, tenant);
                query.setLong(3, user);
                query.setObject(4, version);
                query.setString(5, MODEL);
                try (ResultSet result = query.executeQuery()) {
                    result.next();
                    if (sampleCount < 1 || result.getInt(1) != sampleCount) return -1.0;
                    double score = result.getDouble(2);
                    return result.wasNull() || !Double.isFinite(score) ? -1.0 : score;
                }
            }
        });
    }

    void delete(long tenant, long user, UUID version) {
        scoped(tenant, user, c -> {
            lockVersion(c, version);
            try (PreparedStatement query = c.prepareStatement("""
                    DELETE FROM mes_face_sample WHERE tenant_id=? AND user_id=? AND template_version=?""")) {
                query.setLong(1, tenant);
                query.setLong(2, user);
                query.setObject(3, version);
                query.executeUpdate();
            }
            return null;
        });
    }
}
