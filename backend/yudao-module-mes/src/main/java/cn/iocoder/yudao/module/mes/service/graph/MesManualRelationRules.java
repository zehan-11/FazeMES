package cn.iocoder.yudao.module.mes.service.graph;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Extracts stated facts from common Chinese equipment-manual sentences. */
final class MesManualRelationRules {
    static final String METHOD = "manual_rules_v1";
    record Match(String source, String sourceKind, String relation, String target, String targetKind,
                 int start, int end) {}
    private record Rule(Pattern syntax, String relation, String sourceKind, String targetKind, boolean list) {}

    private static final String PREFIX = "(?:本|该|此|这台|本台|该型)?";
    private static final String LABEL = "[\\p{IsHan}A-Za-z0-9_-]{1,36}";
    private static final String DEVICE = "(?:风扇|风机|空压机|压缩机|泵|机床|输送机|减速机|阀门|控制柜|设备|装置|电机)";
    private static final String PART = "(?:电机|轴承|叶片|扇叶|叶轮|风轮|外壳|罩壳|防护罩|底座|滤网|滤芯|过滤器|传感器|继电器|开关|控制板|线路板|联轴器|密封圈|齿轮|皮带|转轴|转子|定子|线圈|螺栓|螺钉|叶轮轴|泵体|阀体|接线端子|电缆|电源|风道|润滑系统|模块|组件|部件)";
    private static final String FAULT = "(?:异响|噪声过大|振动过大|振动异常|过热|温度过高|漏油|泄漏|卡滞|堵塞|失灵|松动|烧损|裂纹|无法启动|启动失败)";
    private static final String CAUSE = "(?:润滑不足|润滑不良|供电异常|电压过低|电压过高|安装偏差|对中不良|磨损|失衡|松动|堵塞|积尘|短路|断路|老化|缺油|过载|冷却不足)";
    private static final String ACTION = "(?:检查|更换|清理|清洁|清洗|紧固|调整|补充|添加|加注|润滑|重新安装|停机检查)";
    private static final String QUANTITY = "(?:(?:一|两|[1-9][0-9]?)(?:台|个|套|只|块|组|根))?";
    private static final String ITEMS = "[\\p{IsHan}A-Za-z0-9_、 \\t-]{1,170}?";
    private static final Pattern CLAUSE = Pattern.compile("[^。！？；!?;，,\\r\\n]+");
    private static final Pattern CONDITIONAL = Pattern.compile(
            "([^。！？；!?;，,\\r\\n]+?(?:时|后))[，,]\\s*((?:应当|应|须|需要|请)\\s*" + ACTION + LABEL + ")");
    private static final Pattern DEVICE_NAME = ending(DEVICE);
    private static final Pattern PART_NAME = ending(PART);
    private static final Pattern FAULT_NAME = ending(FAULT);
    private static final Pattern CAUSE_NAME = ending(CAUSE);
    private static final Pattern ACTION_TARGET = ending(PART + "|润滑脂|润滑油");
    private static final Pattern LIST_SEPARATOR = Pattern.compile("、|以及|和|与|及");
    private static final Pattern UNSUPPORTED = Pattern.compile("不|无|未|没|禁止|无需|避免|如果|假如|例如|示例|可选|选配|备用|应当|要求|可能|通常|必要时|步骤|是否|仅当|只在|能够");
    private static final List<Rule> RULES = List.of(
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:主要)?(?:由)\\s*(" + ITEMS + ")(?:等部件)?组成"), "包含部件", null, "部件", true),
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:主要)?(?:配备了?|配有|装有|安装有|设有|包含有?|包括)\\s*(" + ITEMS + ")(?:等部件)?"), "包含部件", null, "部件", true),
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:负责|用于)?驱动\\s*(" + LABEL + ")"), "驱动", "部件", "部件", false),
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:在运行中|运行中|运行时)?(?:出现|发生)\\s*(" + LABEL + ")"), "关联故障", null, "故障", false),
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:可能是由|可能由|可能源于|可能是因为)\\s*(" + LABEL + "?)(?:所致|导致|引起|造成)?"), "可能原因", "故障", "原因", false),
            new Rule(Pattern.compile(PREFIX + "(" + LABEL + "?)\\s*(?:是由|由|源于|是因为)\\s*(" + LABEL + "?)(?:所致|导致|引起|造成)?"), "故障原因", "故障", "原因", false)
    );

    private MesManualRelationRules() {}

    static List<Match> extract(String line) {
        List<Match> facts = new ArrayList<>();
        var conditional = CONDITIONAL.matcher(line);
        while (conditional.find()) {
            String condition = conditional.group(1).strip();
            String fault = condition.substring(0, condition.length() - 1).replaceFirst("^(?:当|若|如果)", "");
            String action = conditional.group(2).strip().replaceFirst("^(?:应当|应|须|需要|请)\\s*", "");
            String item = action.replaceFirst("^" + ACTION, "");
            // Match the whole action clause to avoid turning a negated or qualified instruction into a fact.
            if (valid(fault, FAULT_NAME) && valid(item, ACTION_TARGET)
                    && (conditional.end() == line.length() || "。！？；!?;，, ".indexOf(line.charAt(conditional.end())) >= 0)) {
                facts.add(new Match(fault, "故障", "处理措施", action, "措施", conditional.start(), conditional.end()));
            }
        }
        var clause = CLAUSE.matcher(line);
        while (clause.find()) {
            String content = clause.group().strip();
            if (content.length() > 240 || content.startsWith("#") || content.startsWith("例如")) continue;
            parseClause(content, clause.start() + clause.group().indexOf(content), facts);
        }
        return facts;
    }

    private static void parseClause(String content, int start, List<Match> facts) {
        String sentence = content.replaceFirst("^(?:[-*]\\s+|[0-9]+[.、]\\s*)", "");
        start += content.length() - sentence.length();
        content = sentence;
        for (Rule rule : RULES) {
            var match = rule.syntax().matcher(content);
            if (!match.matches()) continue;
            String source = match.group(1), target = match.group(2);
            String sourceKind = rule.sourceKind();
            if (sourceKind == null) {
                if (valid(source, PART_NAME)) sourceKind = "部件";
                else if (valid(source, DEVICE_NAME)) sourceKind = "设备";
                else return;
            } else if (!valid(source, sourceKind.equals("故障") ? FAULT_NAME : PART_NAME)) return;
            Pattern targetPattern = switch (rule.targetKind()) {
                case "故障" -> FAULT_NAME;
                case "原因" -> CAUSE_NAME;
                default -> PART_NAME;
            };
            for (String candidate : rule.list() ? LIST_SEPARATOR.split(target) : new String[]{target}) {
                String name = candidate.strip().replaceFirst("^" + QUANTITY, "");
                if (valid(name, targetPattern) && !source.equals(name)) {
                    facts.add(new Match(source, sourceKind, rule.relation(), name, rule.targetKind(), start,
                            start + match.end()));
                }
            }
            return;
        }
    }

    private static Pattern ending(String suffix) {
        return Pattern.compile("[\\p{IsHan}A-Za-z0-9_-]{0,36}(?:" + suffix + ")");
    }

    private static boolean valid(String name, Pattern syntax) {
        // Preserve lexicalized fault names such as “无法启动” and “接触不良”.
        String qualifierCheck = name.replace("无法启动", "").replace("润滑不足", "").replace("润滑不良", "")
                .replace("对中不良", "").replace("冷却不足", "");
        return syntax.matcher(name).matches() && !UNSUPPORTED.matcher(qualifierCheck).find();
    }
}
