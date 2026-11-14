package cn.iocoder.yudao.module.mes.service.graph;

import cn.iocoder.yudao.framework.common.exception.ServiceException;
import cn.iocoder.yudao.framework.security.core.LoginUser;
import cn.iocoder.yudao.framework.security.core.util.SecurityFrameworkUtils;
import cn.iocoder.yudao.framework.tenant.core.context.TenantContextHolder;
import cn.iocoder.yudao.framework.security.core.service.SecurityFrameworkService;
import cn.iocoder.yudao.module.mes.controller.admin.graph.MesKnowledgeGraphController;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.access.AccessDeniedException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MesKnowledgeGraphServiceTest {
    MesGraphStore store=mock(MesGraphStore.class);
    MesKnowledgeGraphService service=new MesKnowledgeGraphService(store);
    @BeforeEach void login(){TenantContextHolder.setTenantId(1L);SecurityFrameworkUtils.setLoginUser(new LoginUser().setId(10L).setTenantId(1L).setUserType(2),new MockHttpServletRequest());}
    @AfterEach void clear(){TenantContextHolder.clear();SecurityContextHolder.clearContext();}
    Map<String,Object> entity(String id){return Map.of("entity",Map.of("id",id,"name",id,"kind","部件","description",""));}
    @Test void absentIdentityOrMismatchedTenantCannotQueryDatabase(){
        SecurityContextHolder.clearContext();assertThrows(ServiceException.class,()->service.overview(8));verifyNoInteractions(store);
        login();TenantContextHolder.setTenantId(2L);assertThrows(ServiceException.class,()->service.overview(8));verifyNoInteractions(store);
    }
    @Test void everyJoinUsesTrustedScopeAndStableIdParameters(){
        when(store.read(any(),anyString(),anyMap())).thenAnswer(call->{String query=call.getArgument(1);return query.contains("AS entity")?List.of(entity("a")):List.of();});
        assertEquals(1,service.overview(8).nodes().size());service.search("' OR true //",20);service.neighbors("a",20);
        var captor=org.mockito.ArgumentCaptor.forClass(String.class);
        verify(store,atLeast(1)).read(eq(new MesKnowledgeGraphService.Scope(1,10)),captor.capture(),anyMap());
        for(String query:captor.getAllValues()){
            assertTrue(query.contains("tenantId=$tenant"));assertTrue(query.contains("ownerId=$owner"));assertFalse(query.contains("' OR true //"));
            if(query.contains("FazeRelation")){for(String alias:List.of("a","b","r")){assertTrue(query.contains(alias+".tenantId=$tenant"));assertTrue(query.contains(alias+".ownerId=$owner"));}}
        }
    }
    @Test void queryLimitsAndMissingIdsAreRejected(){
        assertThrows(ServiceException.class,()->service.overview(201));assertThrows(ServiceException.class,()->service.search("",20));
        assertThrows(ServiceException.class,()->service.neighbors("a",101));assertThrows(ServiceException.class,()->service.detail(" "));
        verifyNoInteractions(store);assertThrows(ServiceException.class,()->service.detail("missing"));
    }
    @Test void noFallbackOrCredentialDetailsWhenDatabaseFails(){
        when(store.read(any(),anyString(),anyMap())).thenThrow(new IllegalStateException("password=secret; bolt://private"));
        ServiceException failure=assertThrows(ServiceException.class,()->service.overview(8));
        assertEquals(1_047_150_000,failure.getCode());assertFalse(failure.getMessage().contains("secret"));
    }
    @Test void truncationIsReportedAndReturnedEdgesStayBounded(){
        when(store.read(any(),anyString(),anyMap())).thenAnswer(call->{String query=call.getArgument(1);return query.contains("AS entity")?List.of(entity("a"),entity("b")):List.of();});
        var graph=service.overview(1);assertTrue(graph.hasMore());assertEquals(1,graph.nodes().size());
    }
    @Configuration(proxyBeanMethods=false) @EnableMethodSecurity static class MethodSecurity {}
    @Test void allGraphEndpointsRequireKnowledgePermission(){
        Set<String> permissions=new HashSet<>();
        SecurityFrameworkService ss=new SecurityFrameworkService(){
            public boolean hasPermission(String p){return permissions.contains(p);}
            public boolean hasAnyPermissions(String... p){return Arrays.stream(p).anyMatch(permissions::contains);}
            public boolean hasRole(String r){return false;}public boolean hasAnyRoles(String... r){return false;}public boolean hasAnyScopes(String... s){return false;}public boolean hasScope(String s){return false;}
        };
        try(var context=new AnnotationConfigApplicationContext()){
            context.register(MethodSecurity.class);context.registerBean("ss",SecurityFrameworkService.class,()->ss);
            context.registerBean(MesKnowledgeGraphController.class,()->new MesKnowledgeGraphController(service));context.refresh();
            var controller=context.getBean(MesKnowledgeGraphController.class);
            assertThrows(AccessDeniedException.class,()->controller.overview(8));assertThrows(AccessDeniedException.class,()->controller.search("a",20));
            assertThrows(AccessDeniedException.class,()->controller.node("a"));assertThrows(AccessDeniedException.class,()->controller.neighbors("a",20));
            permissions.add("mes:assistant:knowledge");assertNotNull(controller.overview(8).getData());
        }
    }
}
